/*!
* \file      actility-in.js
*
* \brief     Node-Red node for Actility payload parsing
*
* Revised BSD License
* Copyright Semtech Corporation 2020. All rights reserved.
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*     * Redistributions of source code must retain the above copyright
*       notice, this list of conditions and the following disclaimer.
*     * Redistributions in binary form must reproduce the above copyright
*       notice, this list of conditions and the following disclaimer in the
*       documentation and/or other materials provided with the distribution.
*     * Neither the name of the Semtech corporation nor the
*       names of its contributors may be used to endorse or promote products
*       derived from this software without specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
* AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
* IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
* ARE DISCLAIMED. IN NO EVENT SHALL SEMTECH S.A. BE LIABLE FOR ANY DIRECT,
* INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
* (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
* LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
* ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
* (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
* SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

module.exports = function (RED) {
    var lora_packet = require("lora-packet");

    function isValid(data) {
        return (typeof data !== "undefined") && (data !== null);
    }
    function isInteger(data) {
        return (isValid(data) && (data === parseInt(data, 10)));
    };

    function isString(data) {
        return (isValid(data) && (typeof data == "string"));
    };

    function errCompat(node, msg, done, text) {
        if (done) {
            // Node-RED 1.0 compatible
            done(text);
        } else {
            // Node-RED 0.x compatible
            node.error(text, msg);
        }
    }

    function actilityIn(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.on('input', function (msg, send, done) {
            // Backward compatibity with Node-Red 0.x
            send = send || function () { node.send.apply(node, arguments) }
            var msg_das = null;
            var msg_uplink = null;

            try {
                var payload_in = (JSON.parse(msg.payload));
            } catch {
                errCompat(node, msg, done, "Unable to parse input as JSON string");
                return null;
            }
            payload_in = payload_in.DevEUI_uplink;
            if (typeof payload_in === "undefined") {
                errCompat(node, msg, done, 'Unable to find "DevEUI_uplink" key. Payload not from Actility ?');
                return null;
            }

            devEui_das_format = payload_in.DevEUI.match(/.{1,2}/g).join('-');
            const timestamp = new Date(payload_in.Time)

            if (typeof payload_in.rawJoinRequest !== "undefined") {
                msg_das = {
                    "payload": {
                        "deveui": devEui_das_format,
                        "uplink": {
                            "msgtype": "joining",
                            "timestamp": timestamp / 1000,
                        }
                    },
                    "topic": msg.topic,
                };
                this.send([null, msg_das]);
            }

            // Uplink
            msg_uplink = msg;
            msg.uplink = {
                "appSKey": payload_in.AppSKey,
                "devEui": payload_in.DevEUI,
                "dev_addr": payload_in.DevAddr,
                "port": parseInt(payload_in.FPort || "0", 10),
                "f_counter": parseInt(payload_in.FCntUp, 10),
                "rx_timestamp": new Date(payload_in.Time),
                // TBC "frequency_hz":,
                "spreading_factor": parseInt(payload_in.SpFact, 10),
                // TBC "bandwidth": ,
                // TBC "airtime": ,
                "lns": {
                    "name": "actility",
                    "context": payload_in,
                },
            };

            // Decode payload if AppSKey is present
            if (isValid(msg.uplink.appSKey) === true) {
                var packet_fields = {
                    DevAddr: new Buffer.from(msg.uplink.dev_addr, "hex"),
                    FCnt: msg.uplink.f_counter,
                    FPort: msg.uplink.port,
                    payload: new Buffer.from(payload_in.payload_hex, "hex"),
                }
                appSKey = new Buffer.from(msg.uplink.appSKey, "hex");
                var packet = lora_packet.fromFields(packet_fields);
                msg.payload = lora_packet.decrypt(packet, appSKey, appSKey).toString("hex");
                msg.uplink.payload_hex = msg.payload;
                msg.uplink.payload_bytes = new Buffer.from(msg.payload, "hex");
            } else {
                msg.payload = payload_in.payload_hex;
                msg.uplink.payload_hex = msg.payload;
                msg.uplink.payload_bytes = new Buffer.from(msg.payload, "hex");
            }

            var request = {
                "deveui": devEui_das_format,
                "uplink": {
                    "dn_mtu": 51,
                    "dr": msg.uplink.datarate,
                    "fcnt": msg.uplink.f_counter || 0,
                    "payload": "",
                    "timestamp": parseInt(timestamp.getTime()) / 1000,    // Required, timestamp, UTC, float
                }
            };

            if (typeof msg.uplink.frequency !== 'undefined') {
                request.uplink.freq = msg.uplink.frequency;
            }

            if (parseInt(config.port) === msg.uplink.port) {
                request.uplink.payload = msg.payload || "";
                request.uplink.msgtype = "modem";
            } else {
                request.uplink.msgtype = "updf";
                request.uplink.port = msg.uplink.port;
            }

            msg_das = {
                "payload": JSON.stringify(request),
                "topic": msg.topic,
                "uplink": msg.uplink,
            }


            this.send([msg_uplink, msg_das]);
            return null;
        });

        node.on("close", function () {
        });
    }

    RED.nodes.registerType("loracloud-utils-connectors-actility-in", actilityIn);
};