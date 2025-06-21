//========= Blu_to_MQTT v1.4 ========

//_Config_Blu_to_MQT_
var mqtt_Lite= false, //Send only one event/rpc Topic, true/false
    mqttID= "shelly/", //MQTT Topic ID, (behind topic_Prefix), old default "shellyBLU"
    split= "", //Split char, will be between different parts of your topic.
    topic_Prefix= "", //Here you can set your own mqtt Topic Prefix, defult is an empty String
    shelly_Adapter= false, //Send data "Shelly Adapter" friendly, true/false, srcBLE mac will adapt to mainTopic
    mqttID_with_DType= false, //Adds a device type to the MQTT topic ID, true/false
    custom_Names= { //Optional, set custom names for specific Blu Mac addresses
    "60:ef:ab:44:44:e6": "voordeur",
    "8c:6f:b9:13:f3:0e": "achterdeur",
    "3c:2e:f5:72:72:27": "schuifraam",
    "3c:2e:f5:fb:99:ca": "raam_matthias",
    "b0:c7:de:40:fd:45": "motion_bs",
    "38:39:8f:71:01:18": "ht_matthias",
    "0c:ef:f6:02:55:5f": "button_rc_4"
    }, //No "/" or space allowed inside custom names!!!
    mqttQOS= 0, //MQTT QOS Setting, can be --> 0 - at most once, 1 - at least once, 2 - exactly once
    debug= false, //Show debug msg in log, true/false, setting this to 'true' will delay reaktion speed a lot!
    uFixer= true, //Automatically, try to fix a Shelly FW MQTT connection Bug, true/false
    get_All= false; //Get all data available and ship it, default false, should only be used when eco mode is off

//_Config_Blu_Events_
var battery_Fix= true, //Drop, 0% battery BTHome packages on Reboot Event, true/false 
var tH1= 0; //Global Timer

//========= Blu_Events v2.4 =========
let activeScan= true; //Active or Passiv Bluetooth Scan, only used when BT Gateway false! 
//notUsed-->let _cid = "0ba9"; //Allterco, Company ID(MFD)
let devID1= "SBBT"; //Blu Button1, deviceID, --> SBBT-002C
let devID2= "SBDW"; //Blu Door/Window, deviceID --> SBDW-002C
let devID3= 'SBMO'; //Blu Motion, deviceID, --> SBMO-003Z
let devID4= 'SBHT'; //Blu Motion, deviceID, --> SBMO-003Z
let uuid= "fcd2"; //BTHome, Service ID --> UUID(16bit)
let bluMap= {//Device Parameter, you can find the full BTH Device List at 'https://bthome.io/format'
    //bthObjectID:[Property,Datatype,Factor/Unit],
    '0xf0':['device_type_id','uint8','split2'], //All Blu Devices, special case [default --> uint16]
    '0xf1':['firmware_version','uint8','split4'], //All Blu Devices, special case [default--> uint32]
    '0xf2':['extra_data','uint8','split3'], //All Blu Devices, special case [default--> uint24] --> maybe FW version? 
    '0x00':['pid','uint8'], //All Blu Devices
    '0x01':['battery','uint8','%'], //All Blu Devices
    '0x3a':['button','uint8'], //All Blu Devices
    '0x05':['illuminance','uint24',0.01], //Blu Motion & D/W
    '0x45':['temperature','sint16',0.1], //Blu Motion & H&T
    //notUsed-->'0x1a':['door','uint8'], //Blu D/W
    //notUsed-->'0x20':['moisture','uint8'], //Unknown
    '0x41':['distance','uint16',0.1], //BLU Sonic
    '0x03':['humidity','uint16',0.01], //BLU H&T
    '0x2d':['window','uint8'], //Blu D/W
    '0x3f':['rotation','int16',0.1], //Blu D/W
    '0x21':['motion','uint8'], //Blu Motion
    '0x2e':['humidity', 'uint8'],
};

function FixMQTT() { //Restart Shelly if MQTT connection is false for over 11 min.
    print('Debug: MQTT connection Status is _[', MQTT.isConnected(), ']_');
    if(!MQTT.isConnected()){print('Debug: Trying to Fix MQTT Connection with Reboot'); Shelly.call('Shelly.Reboot');}
}
function SendMQTTmsg(obj){
    try{
        if(!obj || !obj.info || !obj.info.data || obj.info.data.gen !== 'GBLE') return; //Exit if useless data
        var ts= obj.info.ts, ev= obj.info.event; //Get stuff outside of data
        obj= obj.info.data; obj.ts= ts; obj.event= ev; ev= undefined;  //Put obj back together 
        if(MQTT.isConnected()){
            //Create MainTopic and input ID
            var mainTopic= "", dID= 'Error_no_ID', edID= Str(obj.device_type_id)||Str(obj.window)||Str(obj.motion), ex= {}; 
            if(mqttID.length > 0) mainTopic= mqttID+split;
            if(edID) dID= 'd'+ edID;
            if(Str(obj.button)) dID= Str(obj.button);
            //Clear uFixer Timer
            if(tH1) Timer.clear(tH1); tH1= 0;
            //Custom name logic
            var cNames= Object.keys(custom_Names), cName= undefined;
            if(cNames.length) cNames.forEach(function(mac){if(obj.mac === mac) cName= custom_Names[mac];});
            cNames= null; //Clear usless data
            //Add stuff to MainTopic, Prefix, MQTTid, custom Name
            if(mqttID_with_DType && obj.device_type) mainTopic+= obj.device_type+split;
            cName ? mainTopic+= cName+'/': mainTopic+= obj.mac+'/';
            if(topic_Prefix.length > 0) mainTopic= topic_Prefix+'/'+mainTopic;
            obj.gateway= info.id; //Get gateway id
            if(obj.firmware_version) obj.last_alive= new Date().toString(); //Get date
            if(debug) print('\nDebug: MQTT Publishing_Topic: ',mainTopic);
            //Shelly Adapter logic
            if(shelly_Adapter){
                mainTopic= mainTopic.slice(0,mainTopic.length-1);
                MQTT.publish(shelly_Prefix+'/events/ble', Str(
                {
                    scriptVersion: '0.1', 
                    src: shelly_Prefix,
                    srcBle: {type: obj.device_type, mac: mainTopic},
                    payload: obj
                 
                 }), mqttQOS);
                if(debug) print('Debug: 1 MQTT message have been sent.');
                return;
            }
            //MQTT lite logic
            if(mqtt_Lite){
                MQTT.publish(mainTopic + 'events/rpc', Str(obj), mqttQOS);
                if(debug) print('Debug: 1 MQTT message have been sent.');
                return;
            }
            if(get_All) ex= {e_id: dID, e_ts: obj.ts, e_ev: obj.event, e_g: obj.gen}; //Create some old eXtra 
            var topicMap= { //Map of known MQTT Topics
                inputKey: 'status/input:'+dID,
                'info/custom_Name': cName,
                'info/battery': obj.battery,
                'info/battery_string': obj.battery_string,
                'info/rssi': obj.rssi,
                'info/encryption': obj.encryption,
                'info/interval': obj.interval,
                'info/bthome_version': obj.bthome_version,
                'info/lastTimeStamp': ex.e_ts,
                'info/lastAktion': ex.e_ev,
                'info/lastAktionID': ex.e_id,
                'info/gen': ex.e_g,
                'info/mac': obj.mac,
                'info/device': obj.device_name,
                'info/deviceType': obj.device_type,
                'info/gateway': obj.gateway,
                'info/last_alive': obj.last_alive,
                'info/device_type_id': obj.device_type_id,
                'info/firmware_version': obj.firmware_version,
                'info/pid': obj.pid,
                'info/new_BTH_HexID': obj.new_BTH_HexID,
                'info/new_data': obj.new_Data,
                'info/info': obj.info,
                'info/extra_data': obj.extra_data,
                'status/deviceState': obj.device_state,
                'status/illuminance': obj.illuminance,
                'status/temperature': obj.temperature,
                'status/distance': obj.distance,
                'status/humidity': obj.humidity,
                'status/rotationLvl': obj.rotation,};
            obj= undefined; //Clear useless Data
            //Send MQTT Msg/topics, publish all msgs
            var oldLength= Object.keys(topicMap).length;
            for(key of Object.keys(topicMap)){
                if(topicMap[key] !== undefined){
                    if(key === 'inputKey'){
                        key= topicMap[key];
                        delete topicMap.inputKey;
                        topicMap[key]= ts;
                        ts= undefined;
                    }
                    if(debug) print('Debug: sending------>',key,'--->',topicMap[key]);
                    let topic= mainTopic+key, value= ''+topicMap[key];
                    MQTT.publish(topic, value, mqttQOS);
                    //MQTT.publish(mainTopic+key, Str(topicMap[key]), mqttQOS)
                    delete topicMap[key]; //Delete useless Data
                }
            }
            if(debug) print('Debug:',oldLength-Object.keys(topicMap).length,'out of',oldLength,'possible MQTT topics have been sent.');
        }else{
            print('Error: MQTT is still not ready, cant send msg');
            if (uFixer && !tH1) {
                print('Debug: Trying to Fix MQTT Connection Bug.');
                tH1 = Timer.set(12 * 60 * 1000, false, FixMQTT);
            }
        }
    }catch(e){ErrorMsg(e,'SendMQTTmsg()');}
}

function CreateEvent(obj){ //Create Blu data and send Blu Events
    try{
        //Somehow filter for device_type, with out local names
        obj.gen= 'GBLE'; obj.device_type= 'Unknown-Type';
        if(typeof obj.button === 'number' && !obj.illuminance || obj.device_type_id === '2.1') obj.device_type= 'Button4';
        if(typeof obj.illuminance === 'number' && !obj.motion || obj.device_type_id === '2.2') obj.device_type= 'Door-Window';
        if(typeof obj.motion === 'number' || obj.device_type_id === '2.5') obj.device_type= 'Motion';
//        obj.gen= 'SBBT'; obj.device_type= 'Button4'; 
        //notUsed-->obj.device_type || obj.device_type_id ? obj.gen= 'GBLE': obj.device_type= 'Unknown-Type';
        //Create device_states
        switch(obj.device_type){
          case 'Button4':
            print('OBJDEBUG:',Str(obj.input));
            let btns=[];
            bclevt = "undefined";            
            for (button = 0; button < 4; button++) {      
                let _bpush = obj.input[button];
                print('bpush',button,':',_bpush);
                if (_bpush === 254) _bpush = 0; // ggf 5 für hold
                if (_bpush === 4) _bpush = 0; // ggf 5 für hold
                if (_bpush > -1) {btns.push('rc4_001_button_'+(button+1) + ':' + _bpush);}
               }            
               bclevt = ''+btns;
//               Shelly.emitEvent(bclevt); //Sending Event    
            break;
        case 'Button':
              obj.device_state= obj.input;
              break;
          case 'Door-Window':
              obj.window === 0 ? obj.device_state= obj.input||0: obj.device_state= obj.input||1;
              break;
          case 'Motion':
              obj.motion === 0 ? obj.device_state= obj.button_input||'no_motion': obj.device_state= obj.input||'motion_detected';
              break;
          default:
              obj.device_state= 3;     
        }
        if(obj.input) delete obj.input;
        if(obj.firmware_version){
            obj.device_state= 'alive';
            if(battery_Fix && obj.battery === 0) delete obj.battery; //Workaround a Blu FW_Update Battery Bug
            if(battery_Fix && get_All && obj.battery_string) delete obj.battery_string; //Workaround a Blu FW_Update Battery Bug
        }
        if(debug) print('\nDebug: Blu_data:\n',obj);
        Shelly.emitEvent(''+obj.device_state, obj); //Sending Event
        if(debug) print('Debug: sending Event __[',obj.device_state,']__');
    }catch(e){ErrorMsg(e,'SendEvent()',debug);}
}

function CheckInput(bI){ //Check for Blu Button Events
    try{
        if(typeof bI !== 'number') return null;
        let buttonMap= ['wake_up', 'single_push', 'double_push', 'triple_push', 'long_push', 'pairing_push', 'default_reset_push'];
        if(bI > 6 && bI !== 254) bI= 'unknown_push';
        if(bI < 7) bI= buttonMap[bI];
        if(bI === 254) bI= 'hold_push';
        return bI;
    }catch(e){ErrorMsg(e,'CheckInput()',debug);}
}
function DeviceName(name){ //Check for locale Device Name
    try{
        if(!name) return 'Hidden-Device';
        if(Cut(name,devID1)) return 'Blu-Button1';
        if(Cut(name,devID2)) return 'Blu-Door-Window';
        if(Cut(name,devID3)) return 'Blu-Motion'; 
        if(Cut(name,devID4)) return 'Blu-H&T'; 
        return 'Unknown-Device--> '+ name;
    }catch(e){ErrorMsg(e,'DeviceName()',debug);}
}
function Unpack(d,m,r,l){ //Create BTHome obj and Unpack BTHome data
    try{
        //Setup declaring variabel and functions
        if(typeof d !== "string" || d.length < 3) return null;
        var obj= {mac: m, rssi: r, device_name: DeviceName(l)}, spC= 0, tmp= []; //Add extra data  
        function Int_To_uInt(int, bytes){
            let mask= 1 << (bytes - 1);
            if(int & mask) return int-(1 << bytes);
            return int;
         }
        //Unpack Info BTHome Byte
        byte= d.at(0); //Getting first Byte as dezimal
        if(byte & 0x01) obj.encryption= true; //Getting encryption;
        if(obj.encryption) throw new Error('BThome Service Data encripted, encription is not supported!');
        if(get_All){ 
            obj.bthome_version=  byte >> 5; //Getting BTHome Version
            (byte & 0x02) ? obj.interval= 'irregular': obj.interval= 'regular'; //Get transmission interval
            if(obj.bthome_version !== 2) throw new Error('Wrong BThome Version: found v.'+obj.bthome_version+' only v.2 supported!');
        }else{delete obj.encryption; if(obj.device_name === "Hidden-Device") delete obj.device_name;} //Reduce data
        d= d.slice(1); //Delete useless Info byte
        //Unpack BThome Values
        for(let value of d){ //Search for matching BTHome hex ID
            if(d.length < 1) break;
            if(!spC) byte= btoh(d[0]); //Getting BTHome object ID
            let bluData= bluMap['0x'+byte]; //Getting blu Data
            if(bluData === undefined){ //Debug handling
                print('Error: Unknown BThome Data--> HexID: 0x',byte,', you can add more id from the full objID list--> https://bthome.io/format');
                obj.new_BTH_HexID= byte;
                obj.new_Data= btoa(d);
                obj.info= 'Please send the newBTH_HexID and newData to this script developer so that they can integrate it.';
                break;
            }
            if(!spC) d= d.slice(1); //Delete usless bth ID byte
            // Merge value bytes

            let max= Number(Cut(bluData[1],'int','int'))/8; //Getting max Bytes out of dataType
            if(d.length < max) throw new Error('Wrong DataType, '+d.length+' Bytes, payload to big for DataType: '+bluData[1]+' max->'+max);
            if(max === 1) value= d.at(0);
            else if(max === 2) value= (d.at(1) << 8) | d.at(0);
            else if(max === 3) value= (d.at(2) << 16) | (d.at(1) << 8) | d.at(0);
            //notUsed-->else if(max === 4) value= (d.at(3) << 24) | (d.at(2) << 16) | (d.at(1) << 8) | d.at(0);
            d= d.slice(max); //Delete useless value Bytes
            if(!Cut(bluData[1],'u','u')) value= Int_To_uInt(value,max*8); //Convert int to uint
            if(value === undefined) break; //Exit value loop
            //Adding String/Unit to value
            let is_Str= typeof bluData[2] === 'string';
            if (typeof bluData[2] === 'number') value= value*bluData[2]; //Adding factor
            if(is_Str && !spC && Cut(bluData[2],'split')) spC= Number(Cut(bluData[2],'split','split'))+1; //Get split counter
            if(spC){
                tmp.push(value); //Saving value for special case
                spC--; //reduce split counter
            }else{
                obj[bluData[0]]= value; //Saving value
            }
            if(is_Str && !spC && get_All) value= ''+value+bluData[2]; //Adding unit
            if(is_Str && !spC && get_All) obj[bluData[0]+'_string']= value; //Saving String Value
            if(spC === 1){
                value= [];
                for(let i in tmp){
                    value[(tmp.length-1)-i]= tmp[i]; //Reverse Array
                }
                tmp= []; //Clear useless data
                obj[bluData[0]]= value.join('.'); //Join FW version into String
                spC= 0; //Exit special case
            }
        }
        return obj;
    }catch(e){ErrorMsg(e,'Unpack()',debug);}
}
var old_pid= [-1,-1,-1,-1], old_mac= [-1,-1,-1,-1], iX= 0;
function ScanCB(e,r) { //BT Scan Loop
    try{      
        if(e !== 2 || !r) return; //Exit if empty scan
        if(!r.service_data || !r.service_data[uuid]){

          return; //Exit if not BTHome data
        } 
        let obj= Unpack(r.service_data[uuid],r.addr,r.rssi,r.local_name); //Create BTHome Obj & Unpack BTHome Data
        
        if(!obj) throw new Error('Failed to unpack service_data --> _[ '+btoa(r.service_data[uuid])+' ]_');
        //Anti Double msg Logic 
        if((obj.pid === old_pid[0] && obj.mac === old_mac[0])||(obj.pid === old_pid[1] && obj.mac === old_mac[1])||
           (obj.pid === old_pid[2] && obj.mac === old_mac[2])||(obj.pid === old_pid[3] && obj.mac === old_mac[3])
        ) return;//Exit if double msg 
        if(debug) print('Debug: Anti Double, saved Data:',iX,'\n',old_pid,'\n',old_mac);
        if(iX >= old_pid.length) iX= 0;
        old_pid[iX]= obj.pid; old_mac[iX]= obj.mac;
        iX++ //increas counter;
        if(!get_All && obj.pid) delete obj.pid; //reduce data
        if(debug){ //Debug output
            r.service_data[uuid]= btoa(r.service_data[uuid]);
            r.advData= btoa(r.advData);
            print('\nDebug: BT_data:\n',r,'\nDebug: BTHome_data:\n', obj);} 
        r= undefined, e= undefined; //Delete useless data
        obj.input= CheckInput(obj.button);
        if(!obj.input) delete obj.input; //Delete useless data
        CreateEvent(obj); //Creating Event out of bthObj
    }catch(e){ErrorMsg(e,'ScanCB()',debug);}
}

var shelly_Prefix= 0;
function Main(){ //Main syncron Script Code
    BLE.Scanner.Start({duration_ms: -1, active: activeScan}, ScanCB); //Sub to passiv BT Scanner, start a new scan if no scanner is runnning
    BLE.Scanner.isRunning() ? print('Status: BLE.Scanner is scanning in Background.'): print('Status: BLE.Scanner cannot be initiated, check your Bluetooth settings!');
    shelly_Prefix= Shelly.getComponentConfig("Mqtt").topic_prefix
    Shelly.addEventHandler(SendMQTTmsg); //Create Event Loop
}

//Toolbox v1.0(Cut), a universal Toolbox for Shelly scripts
function Str(d){ //Upgrade JSON.stringify
    try{
        if(d === null || d === undefined) return null; if(typeof d === 'string')return d; 
        return JSON.stringify(d);}catch(e){ErrorMsg(e,'Str()');

    }
}

function Cut(f,k,o,i){ //Upgrade slice f=fullData, k=key-> where to cut, o=offset->offset behind key, i=invertCut
    try{
        let s= f.indexOf(k); if(s === -1) return null; if(o) s= s+o.length || s+o; if(i) return f.slice(0,s); 
        return f.slice(s);}catch(e){ErrorMsg(e,'Cut()');}}
function Setup(){ //Wating 2sek, to avoid a Shelly FW Bug
    try{
        if(Main && !tH9){tH9= Timer.set(2000,0,function(){print('\nStatus: started Script _[', scriptN,']_');
        if(callLimit > 4){callLimit= 4;} try{Main();}catch(e){ErrorMsg(e,'Main()'); tH9= 0; Setup();}});}}catch(e){ErrorMsg(e,'Setup()');}}
function ErrorMsg(e,s,deBug){ //Toolbox formatted Error Msg
     try{
         let i=0; if(Cut(e.message, '-104: Timed out')) i= 'wrong URL or device may be offline';
         if(Cut(e.message, 'calls in progress')) i= 'reduce _[ callLimit ]_ by 1 and try again, its a global variabel at the end of the toolbox';
         if(s === 'Main()' || deBug) i= e.stack; if(Cut(e.message, '"Main" is not')) i= 'define a Main() function before using Setup()';
         print('Error:',s || "",'---> ',e.type,e.message); if(i) print('Info: maybe -->',i);}catch(e){print('Error: ErrorMsg() --->',JSON.stringify(e));}}
var tH8= 0, tH9= 0, aC= 0, cCache= [], nCall= [], callLimit= 4, cacheLimit= 40, cSp= 0.1; //Toolbox global variable
var Status= Shelly.getComponentStatus, Config= Shelly.getComponentConfig; //Renamed native function 
var info= Shelly.getDeviceInfo(), scriptID= Shelly.getCurrentScriptId(), scriptN= Config('script',scriptID).name; //Pseudo const, variabel
//Toolbox v1.0(cut), Shelly FW >1.0.8
Setup();
