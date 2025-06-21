/**
 * This script lets you use your Gen2 device as a gateway between Shelly BLU Wall Switch 4 and other Shelly devices (no matter Gen1 or Gen2)
 * by sending local requests by their local IP APIs.+
 * Based on the blu Button-Script
 * Script modifed by Bert CLAES 2024
 * 
 * What you should change before using it:
 * > bluButtonAddress -> You should put the mac address of your blu button here.
 * 
 * Limitations:
 * > At the moment there is a limit of 5 RPC calls at the same time and because of this, the script will execute every 3 urls with a 1 second delay.
 *      Limitations can be check here: https://shelly-api-docs.shelly.cloud/gen2/Scripts/ShellyScriptLanguageFeatures#resource-limits
 * 
 * other Shelly device shoud have 'Bluetooth Gateway' disabled otherwise local_name cannot be resolved
 */


/** =============================== CHANGE HERE =============================== */
let CONFIG = {
    HTAddress: "3c:2e:f5:fb:99:ca",
};

let custom_Names= { 
    "60:ef:ab:44:44:e6": "voordeur",
    "8c:6f:b9:13:f3:0e": "achterdeur",
    "3c:2e:f5:72:72:27": "schuifraam",
    "3c:2e:f5:fb:99:ca": "raam_matthias",
    "b0:c7:de:40:fd:45": "motion_bs",
    "38:39:8f:71:01:18": "ht_matthias",
    "0c:ef:f6:02:55:5f": "rc4_001_button"
    };
/** =============================== STOP CHANGING HERE =============================== */

let urlsPerCall = 3; 
let urlsQueue = [];
let callsCounter = 0;

let ALLTERCO_MFD_ID_STR = "0ba9";
let BTHOME_SVC_ID_STR = "fcd2";

const uint8 = 0;
const int8 = 1;
const uint16 = 2;
const int16 = 3;
const uint24 = 4;
const int24 = 5;

// The BTH object defines the structure of the BTHome data
const BTH = {
  0x00: { n: "pid", t: uint8 },
  0x01: { n: "battery", t: uint8, u: "%" },
  0x02: { n: "temperature", t: int16, f: 0.01, u: "tC" },
  0x03: { n: "humidity", t: uint16, f: 0.01, u: "%" },
  0x05: { n: "illuminance", t: uint24, f: 0.01 },
  0x1a: { n: "door", t: uint8 },
  0x20: { n: "moisture", t: uint8 },
  0x21: { n: "motion", t: uint8 },
  0x2d: { n: "window", t: uint8 },
  0x2e: { n: "humidity", t: uint8, u: "%" },
  0x3a: { n: "button", t: uint8, b: 1 },
  0x3f: { n: "rotation", t: int16, f: 0.1 },
  0x45: { n: "temperature", t: int16, f: 0.1, u: "tC" },
};


function getByteSize(type) {
    if (type === uint8 || type === int8) return 1;
    if (type === uint16 || type === int16) return 2;
    if (type === uint24 || type === int24) return 3;
    //impossible as advertisements are much smaller;
    return 255;
}

let BTHomeDecoder = {
    utoi: function (num, bitsz) {
        let mask = 1 << (bitsz - 1);
        return num & mask ? num - (1 << bitsz) : num;
    },
    getUInt8: function (buffer) {
        return buffer.at(0);
    },
    getInt8: function (buffer) {
        return this.utoi(this.getUInt8(buffer), 8);
    },
    getUInt16LE: function (buffer) {
        return 0xffff & ((buffer.at(1) << 8) | buffer.at(0));
    },
    getInt16LE: function (buffer) {
        return this.utoi(this.getUInt16LE(buffer), 16);
    },
    getUInt24LE: function (buffer) {
        return (
            0x00ffffff & ((buffer.at(2) << 16) | (buffer.at(1) << 8) | buffer.at(0))
        );
    },
    getInt24LE: function (buffer) {
        return this.utoi(this.getUInt24LE(buffer), 24);
    },
    getBufValue: function (type, buffer) {
        if (buffer.length < getByteSize(type)) return null;
        let res = null;
        if (type === uint8) res = this.getUInt8(buffer);
        if (type === int8) res = this.getInt8(buffer);
        if (type === uint16) res = this.getUInt16LE(buffer);
        if (type === int16) res = this.getInt16LE(buffer);
        if (type === uint24) res = this.getUInt24LE(buffer);
        if (type === int24) res = this.getInt24LE(buffer);
        return res;
    },
    unpack: function (buffer) {
        //beacons might not provide BTH service data
        if (typeof buffer !== "string" || buffer.length === 0) return null;
        let result = {};
        let _dib = buffer.at(0);


        result["encryption"] = _dib & 0x1 ? true : false;
        result["BTHome_version"] = _dib >> 5;
        if (result["BTHome_version"] !== 2) return null;
        //can not handle encrypted data
        if (result["encryption"]) return result;
        buffer = buffer.slice(1);

        let _bth;
        let _value;
        let _name;
        let _btnNum = 0;
        
        while (buffer.length > 0) {
            _bth = BTH[buffer.at(0)];
            if (typeof _bth === "undefined") {
                console.log("BTH: unknown type");
                break;
            }
            buffer = buffer.slice(1);
 
            _value = this.getBufValue(_bth.t, buffer);
            if (_value === null) break;
            if (typeof _bth.f !== "undefined") _value = _value * _bth.f;
            _name = _bth.n;
 
            if (typeof _bth.b !== "undefined"){
               _name = _name + _btnNum.toString();
               _btnNum++;
            }
            result[_name] = _value;
          
            buffer = buffer.slice(getByteSize(_bth.t));
        }
        return result;
    },
};

let lastPacketId = 0x100;
function bleScanCallback(event, result) {

    //exit if the call is not for a received result
    if (event !== BLE.Scanner.SCAN_RESULT) {
        return;
    }

    //exit if the data is not coming from a Shelly Blu button1 and if the mac address doesn't match
    if (    typeof result.local_name === "undefined" || 
            typeof result.addr === "undefined" // ||
            //result.addr !== CONFIG.HTAddress
    ) {
          return;
    }
    let servData = result.service_data;
    
    //exit if service data is null/device is encrypted
    if(servData === null || typeof servData === "undefined" || typeof servData[BTHOME_SVC_ID_STR] === "undefined") {
//        console.log("Can't handle encrypted devices-->" + servData);
        return;
    }

    let receivedData = BTHomeDecoder.unpack(servData[BTHOME_SVC_ID_STR]);
    //exit if unpacked data is null or the device is encrypted  
    if(receivedData === null || typeof receivedData === "undefined" || receivedData["encryption"]) {
        console.log("Can't handle encrypted devices");
        return;
    }

    //exit if the event is duplicated
    if (lastPacketId === receivedData.pid) {
        return;
    }
    lastPacketId = receivedData["pid"];
    deviceName = getCustomName(result.addr);
    if (result.local_name.indexOf("SBDW") !== -1){
       lux_evt = deviceName + '/illuminance:' + receivedData["illuminance"];
       state_evt  = deviceName + '/window:' + receivedData["window"];
       rotation_evt  = deviceName + '/rotation:' + receivedData["rotation"];
       Shelly.emitEvent(lux_evt); //Sending Event
       Shelly.emitEvent(state_evt); //Sending Event
       Shelly.emitEvent(rotation_evt); //Sending Event
       //TODO: Battery state + change from MQTT to UDP in Loxone
    } else if (result.local_name.indexOf("SBBT") !== -1){
        let canSend=true;
        let resetevt = ""     
        let btns=[];
        let bclevt = "undefined";
        let reset = [];
        for (button = 0; button < 4; button++) {     
            let _bpush = receivedData["button"+button.toString(0)];
            if (_bpush === 254) canSend = false; // ggf 5 für hold
            if (_bpush === 4) _bpush = 0; // ggf 5 für hold
            if (_bpush > -1) {btns.push('rc4_001_button_'+(button+1) + ':' + _bpush);}
            reset.push(deviceName +'_'+(button+1) + ':0');
            }
        bclevt = ''+btns;
        resetevt = ''+reset;
        if (canSend){
            Shelly.emitEvent(bclevt); //Sending Event
            canSend=true;
            Shelly.emitEvent(resetevt); //Sending Event        
        }
    } else if (result.local_name.indexOf("SBHT") !== -1){
        temp_evt = deviceName + '/temperature:' + receivedData["temperature"];
        hum_evt  = deviceName + '/humidity:' + receivedData["humidity"];
        Shelly.emitEvent(temp_evt); //Sending Event
        Shelly.emitEvent(hum_evt); //Sending Event
     } else if (result.local_name.indexOf("SBMO") !== -1){
        motion_evt = deviceName + '/motion:' + receivedData["motion"];
        Shelly.emitEvent(motion_evt); //Sending Event
     }
}

function bleScan() {
    //check whether the bluethooth is enabled
    let bleConfig = Shelly.getComponentConfig("ble");

    //exit if the bluetooth is not enabled
    if(bleConfig.enable === false) {
        console.log("BLE is not enabled");
        return;
    }

    //start the scanner
    let bleScanner = BLE.Scanner.Start({
        duration_ms: BLE.Scanner.INFINITE_SCAN,
        active: true
    });

    //exist if the scanner can not be started
    if(bleScanner === false) {
        console.log("Error when starting the BLE scanner");
        return;
    }

    BLE.Scanner.Subscribe(bleScanCallback);
    console.log("BLE is successfully started");
}

function init() {
    //exit if there isn't a config
    if(typeof CONFIG === "undefined") {
        console.log("Can't read the config");
        return;
    }

    //exit if there isn't a blu button address
    if(typeof CONFIG.HTAddress !== "string") {
        console.log("Error with the Shelly BLU button1's address");
        return;
    }
    
    //start the ble scan
    bleScan();
}

function getCustomName(mac){
    var cNames= Object.keys(custom_Names), cName= "undefined";
    if(cNames.length){
        for(const name of cNames){
          if (name === mac){
            cName = custom_Names[mac];  
          }
        }
    } 
    return cName;
}

//init the script
init();
