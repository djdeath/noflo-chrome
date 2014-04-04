/**
 * Copyright (c) 2013 The Chromium Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 **/

var http = function() {

    var clientSockets = {};

    // Http response code strings.
    var responseMap = {
        200: 'OK',
        301: 'Moved Permanently',
        304: 'Not Modified',
        400: 'Bad Request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not Found',
        413: 'Request Entity Too Large',
        414: 'Request-URI Too Long',
        500: 'Internal Server Error'};

    /**
     * Convert from an ArrayBuffer to a string.
     * @param {ArrayBuffer} buffer The array buffer to convert.
     * @return {string} The textual representation of the array.
     */
    var arrayBufferToString = function(buffer) {
        var array = new Uint8Array(buffer);
        var str = '';
        for (var i = 0; i < array.length; ++i) {
            str += String.fromCharCode(array[i]);
        }
        return str;
    };

    /**
     * Convert a string to an ArrayBuffer.
     * @param {string} string The string to convert.
     * @return {ArrayBuffer} An array buffer whose bytes correspond to the string.
     */
    var stringToArrayBuffer = function(string) {
        var buffer = new ArrayBuffer(string.length);
        var bufferView = new Uint8Array(buffer);
        for (var i = 0; i < string.length; i++) {
            bufferView[i] = string.charCodeAt(i);
        }
        return buffer;
    };

    /**
     * An event source can dispatch events. These are dispatched to all of the
     * functions listening for that event type with arguments.
     * @constructor
     */
    function EventSource() {
        this.listeners_ = {};
    };

    EventSource.prototype = {
        /**
         * Add |callback| as a listener for |type| events.
         * @param {string} type The type of the event.
         * @param {function(Object|undefined): boolean} callback The function to call
         *     when this event type is dispatched. Arguments depend on the event
         *     source and type. The function returns whether the event was "handled"
         *     which will prevent delivery to the rest of the listeners.
         */
        addEventListener: function(type, callback) {
            if (!this.listeners_[type])
                this.listeners_[type] = [];
            this.listeners_[type].push(callback);
        },

        /**
         * Remove |callback| as a listener for |type| events.
         * @param {string} type The type of the event.
         * @param {function(Object|undefined): boolean} callback The callback
         *     function to remove from the event listeners for events having type
         *     |type|.
         */
        removeEventListener: function(type, callback) {
            if (!this.listeners_[type])
                return;
            for (var i = this.listeners_[type].length - 1; i >= 0; i--) {
                if (this.listeners_[type][i] == callback) {
                    this.listeners_[type].splice(i, 1);
                }
            }
        },

        /**
         * Dispatch an event to all listeners for events of type |type|.
         * @param {type} type The type of the event being dispatched.
         * @param {...Object} var_args The arguments to pass when calling the
         *     callback function.
         * @return {boolean} Returns true if the event was handled.
         */
        dispatchEvent: function(type, var_args) {
            if (!this.listeners_[type])
                return false;
            for (var i = 0; i < this.listeners_[type].length; i++) {
                if (this.listeners_[type][i].apply(
                    /* this */ null,
                    /* var_args */ Array.prototype.slice.call(arguments, 1))) {
                    return true;
                }
            }
        }
    };

    /**
     * HttpServer provides a lightweight Http web server. Currently it only
     * supports GET requests and upgrading to other protocols (i.e. WebSockets).
     * @constructor
     */
    function HttpServer() {
        EventSource.apply(this);
        this.readyState_ = 0;

        chrome.sockets.tcpServer.onAccept.addListener(this.acceptConnection_.bind(this));
        chrome.sockets.tcp.onReceive.addListener(this.onReceive_.bind(this));
        chrome.sockets.tcp.onReceiveError.addListener(this.onReceiveError_.bind(this));
    }

    HttpServer.prototype = {
        __proto__: EventSource.prototype,

        /**
         * Listen for connections on |port| using the interface |host|.
         * @param {number} port The port to listen for incoming connections on.
         * @param {string=} opt_host The host interface to listen for connections on.
         *     This will default to 0.0.0.0 if not specified which will listen on
         *     all interfaces.
         */
        listen: function(port, opt_host) {
            chrome.sockets.tcpServer.create({}, function(socketInfo) {
                this.socketId = socketInfo.socketId;
                chrome.sockets.tcpServer.listen(this.socketId, '0.0.0.0', port, 50, function(result) {
                    if (result < 0) {
                        console.log('failed to listen ' + result);
                        chrome.sockets.tcpServer.close(this.socketId);
                    } else {
                        console.log('listening on ' + port);
                        this.readyState_ = 1;
                    }
                }.bind(this));
            }.bind(this));
        },

        acceptConnection_: function(acceptInfo) {
            this.onConnection_(acceptInfo.clientSocketId);
        },

        onConnection_: function(socketId) {
            this.addClientSocket_(socketId);
            chrome.sockets.tcp.setPaused(socketId, false);
        },

        addClientSocket_: function(socketId) {
            clientSockets[socketId] = { requestData: '', endIndex: 0 };
        },

        closeClientSocket_: function(socketId) {
            chrome.sockets.tcp.close(socketId);
            delete clientSockets[socketId];
        },

        onReceive_: function(readInfo) {
            // Is this a connection we need to listen to?
            var socketId = readInfo.socketId;
            if (!clientSockets[socketId])
                return;

            // HTTP headers parsed
            if (clientSockets[socketId].headersDone)
                return;

            clientSockets[socketId].requestData += arrayBufferToString(readInfo.data).replace(/\r\n/g, '\n');
            // Check for end of request.
            clientSockets[socketId].endIndex = clientSockets[socketId].requestData.indexOf('\n\n', clientSockets[socketId].endIndex);
            if (clientSockets[socketId].endIndex == -1) {
                clientSockets[socketId].endIndex = clientSockets[socketId].requestData.length - 1;
                return;
            }

            var headers = clientSockets[socketId].requestData.substring(0, clientSockets[socketId].endIndex).split('\n');
            var headerMap = {};
            // headers[0] should be the Request-Line
            var requestLine = headers[0].split(' ');
            headerMap['method'] = requestLine[0];
            headerMap['url'] = requestLine[1];
            headerMap['Http-Version'] = requestLine[2];
            for (var i = 1; i < headers.length; i++) {
                requestLine = headers[i].split(':', 2);
                if (requestLine.length == 2)
                    headerMap[requestLine[0]] = requestLine[1].trim();
            }
            var request = new HttpRequest(headerMap, socketId);

            clientSockets[socketId].headersDone = true;
            this.onRequest_(request);
        },

        onReceiveError_: function (readInfo) {
            var socketId = readInfo.socketId;
            if (!clientSockets[socketId])
                return;

            console.log('receive error :');
            console.log(readInfo);

            this.closeClientSocket_(socketId);
        },

        onRequest_: function(request) {
            var type = request.headers['Upgrade'] ? 'upgrade' : 'request';
            var keepAlive = request.headers['Connection'] == 'keep-alive';
            if (!this.dispatchEvent(type, request))
                request.close();
            else if (!keepAlive)
                this.closeClientSocket_(request.socketId_);
        },
    };

    // MIME types for common extensions.
    var extensionTypes = {
        'css': 'text/css',
        'html': 'text/html',
        'htm': 'text/html',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'js': 'text/javascript',
        'png': 'image/png',
        'svg': 'image/svg+xml',
        'txt': 'text/plain'};

    /**
     * Constructs an HttpRequest object which tracks all of the request headers and
     * socket for an active Http request.
     * @param {Object} headers The HTTP request headers.
     * @param {number} socketId The socket Id to use for the response.
     * @constructor
     */
    function HttpRequest(headers, socketId) {
        this.version = 'HTTP/1.1';
        this.headers = headers;
        this.responseHeaders_ = {};
        this.headersSent = false;
        this.socketId_ = socketId;
        this.writes_ = 0;
        this.bytesRemaining = 0;
        this.finished_ = false;
        this.readyState = 1;
    }

    HttpRequest.prototype = {
        __proto__: EventSource.prototype,

        /**
         * Closes the Http request.
         */
        close: function() {
            // The socket for keep alive connections will be re-used by the server.
            // Just stop referencing or using the socket in this HttpRequest.
            if (this.headers['Connection'] != 'keep-alive') {
                chrome.sockets.tcp.close(this.socketId_);
            }
            this.socketId_ = 0;
            this.readyState = 3;
        },

        /**
         * Write the provided headers as a response to the request.
         * @param {int} responseCode The HTTP status code to respond with.
         * @param {Object} responseHeaders The response headers describing the
         *     response.
         */
        writeHead: function(responseCode, responseHeaders) {
            var headerString = this.version + ' ' + responseCode + ' ' +
                (responseMap[responseCode] || 'Unknown');
            this.responseHeaders_ = responseHeaders;
            if (this.headers['Connection'] == 'keep-alive')
                responseHeaders['Connection'] = 'keep-alive';
            if (!responseHeaders['Content-Length'] && responseHeaders['Connection'] == 'keep-alive')
                responseHeaders['Transfer-Encoding'] = 'chunked';
            for (var i in responseHeaders) {
                headerString += '\r\n' + i + ': ' + responseHeaders[i];
            }
            headerString += '\r\n\r\n';
            this.write_(stringToArrayBuffer(headerString));
        },

        /**
         * Writes data to the response stream.
         * @param {string|ArrayBuffer} data The data to write to the stream.
         */
        write: function(data) {
            if (this.responseHeaders_['Transfer-Encoding'] == 'chunked') {
                var newline = '\r\n';
                var byteLength = (data instanceof ArrayBuffer) ? data.byteLength : data.length;
                var chunkLength = byteLength.toString(16).toUpperCase() + newline;
                var buffer = new ArrayBuffer(chunkLength.length + byteLength + newline.length);
                var bufferView = new Uint8Array(buffer);
                for (var i = 0; i < chunkLength.length; i++)
                    bufferView[i] = chunkLength.charCodeAt(i);
                if (data instanceof ArrayBuffer) {
                    bufferView.set(new Uint8Array(data), chunkLength.length);
                } else {
                    for (var i = 0; i < data.length; i++)
                        bufferView[chunkLength.length + i] = data.charCodeAt(i);
                }
                for (var i = 0; i < newline.length; i++)
                    bufferView[chunkLength.length + byteLength + i] = newline.charCodeAt(i);
                data = buffer;
            } else if (!(data instanceof ArrayBuffer)) {
                data = stringToArrayBuffer(data);
            }
            this.write_(data);
        },

        /**
         * Finishes the HTTP response writing |data| before closing.
         * @param {string|ArrayBuffer=} opt_data Optional data to write to the stream
         *     before closing it.
         */
        end: function(opt_data) {
            if (opt_data)
                this.write(opt_data);
            if (this.responseHeaders_['Transfer-Encoding'] == 'chunked')
                this.write('');
            this.finished_ = true;
            this.checkFinished_();
        },

        /**
         * Automatically serve the given |url| request.
         * @param {string} url The URL to fetch the file to be served from. This is
         *     retrieved via an XmlHttpRequest and served as the response to the
         *     request.
         */
        serveUrl: function(url) {
            var t = this;
            var xhr = new XMLHttpRequest();
            xhr.onloadend = function() {
                var type = 'text/plain';
                if (this.getResponseHeader('Content-Type')) {
                    type = this.getResponseHeader('Content-Type');
                } else if (url.indexOf('.') != -1) {
                    var extension = url.substr(url.indexOf('.') + 1);
                    type = extensionTypes[extension] || type;
                }
                console.log('Served ' + url);
                var contentLength = this.getResponseHeader('Content-Length');
                if (xhr.status == 200)
                    contentLength = (this.response && this.response.byteLength) || 0;
                t.writeHead(this.status, {
                    'Content-Type': type,
                    'Content-Length': contentLength});
                t.end(this.response);
            };
            xhr.open('GET', url, true);
            xhr.responseType = 'arraybuffer';
            xhr.send();
        },

        write_: function(array) {
            var t = this;
            this.bytesRemaining += array.byteLength;
            chrome.sockets.tcp.send(this.socketId_, array, function (writeInfo) {
                if (writeInfo.bytesSent < 0) {
                    console.error('Error writing to socket, code ' + writeInfo.bytesSent);
                    return;
                }
                t.bytesRemaining -= writeInfo.bytesSent;
                t.checkFinished_();
            });
        },

        checkFinished_: function() {
            if (!this.finished_ || this.bytesRemaining > 0)
                return;
            this.close();
        }
    };

    /**
     * Constructs a server which is capable of accepting WebSocket connections.
     * @param {HttpServer} httpServer The Http Server to listen and handle
     *     WebSocket upgrade requests on.
     * @constructor
     */
    function WebSocketServer(httpServer) {
        EventSource.apply(this);
        httpServer.addEventListener('upgrade', this.upgradeToWebSocket_.bind(this));
    }

    WebSocketServer.prototype = {
        __proto__: EventSource.prototype,

        upgradeToWebSocket_: function(request) {
            if (request.headers['Upgrade'] != 'websocket' ||
                !request.headers['Sec-WebSocket-Key']) {
                console.log('websocket server reject request, not websocket');
                return false;
            }

            if (this.dispatchEvent('request', new WebSocketRequest(request))) {
                if (request.socketId_)
                    request.reject();
                console.log('websocket server accept request');
                return true;
            }

            console.log('websocket server reject request unhandled request');

            return false;
        }
    };

    /**
     * Constructs a WebSocket request object from an Http request. This invalidates
     * the Http request's socket and offers accept and reject methods for accepting
     * and rejecting the WebSocket upgrade request.
     * @param {HttpRequest} httpRequest The HTTP request to upgrade.
     */
    function WebSocketRequest(httpRequest) {
        // We'll assume control of the socket for this request.
        HttpRequest.apply(this, [httpRequest.headers, httpRequest.socketId_]);
        httpRequest.socketId_ = 0;
    }

    WebSocketRequest.prototype = {
        __proto__: HttpRequest.prototype,

        /**
         * Accepts the WebSocket request.
         * @return {WebSocketServerSocket} The websocket for the accepted request.
         */
        accept: function() {
            // Construct WebSocket response key.
            var clientKey = this.headers['Sec-WebSocket-Key'];
            var toArray = function(str) {
                var a = [];
                for (var i = 0; i < str.length; i++) {
                    a.push(str.charCodeAt(i));
                }
                return a;
            }
            var toString = function(a) {
                var str = '';
                for (var i = 0; i < a.length; i++) {
                    str += String.fromCharCode(a[i]);
                }
                return str;
            }

            // Magic string used for websocket connection key hashing:
            // http://en.wikipedia.org/wiki/WebSocket
            var magicStr = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

            // clientKey is base64 encoded key.
            clientKey += magicStr;
            var sha1 = new Sha1();
            sha1.reset();
            sha1.update(toArray(clientKey));
            var responseKey = btoa(toString(sha1.digest()));
            var responseHeader = {
                'Upgrade': 'websocket',
                'Connection': 'Upgrade',
                'Sec-WebSocket-Accept': responseKey};
            if (this.headers['Sec-WebSocket-Protocol'])
                responseHeader['Sec-WebSocket-Protocol'] = this.headers['Sec-WebSocket-Protocol'];
            this.writeHead(101, responseHeader);
            var socket = new WebSocketServerSocket(this.socketId_);
            // Detach the socket so that we don't use it anymore.
            this.socketId_ = 0;
            return socket;
        },

        /**
         * Rejects the WebSocket request, closing the connection.
         */
        reject: function() {
            this.close();
        }
    }

    /**
     * Constructs a WebSocketServerSocket using the given socketId. This should be
     * a socket which has already been upgraded from an Http request.
     * @param {number} socketId The socket id with an active websocket connection.
     */
    function WebSocketServerSocket(socketId) {
        this.socketId = socketId;
        EventSource.apply(this);
        //this.onReceive_ = this.onReceive_.bind(this);
        //this.onReceiveError_ = this.onReceiveError_.bind(this);
        this.readFromSocket_();
    }

    WebSocketServerSocket.prototype = {
        __proto__: EventSource.prototype,

        /**
         * Send |data| on the WebSocket.
         * @param {string} data The data to send over the WebSocket.
         */
        send: function(data) {
            this.sendFrame_(1, data);
        },

        /**
         * Begin closing the WebSocket. Note that the WebSocket protocol uses a
         * handshake to close the connection, so this call will begin the closing
         * process.
         */
        close: function() {
            this.sendFrame_(8);
            this.readyState = 2;
        },

        readFromSocket_: function() {
            var data = [];
            var message = '';
            var fragmentedOp = 0;
            var fragmentedMessage = '';

            var onDataReadError = function (readInfo) {
                if (this.socketId !== readInfo.socketId)
                    return;

                this.close_();
            };

            var onDataRead = function(readInfo) {
                if (this.socketId !== readInfo.socketId)
                    return;

                var a = new Uint8Array(readInfo.data);
                for (var i = 0; i < a.length; i++)
                    data.push(a[i]);

                while (data.length) {
                    var length_code = -1;
                    var data_start = 6;
                    var mask;
                    var fin = (data[0] & 128) >> 7;
                    var op = data[0] & 15;

                    if (data.length > 1)
                        length_code = data[1] & 127;
                    if (length_code > 125) {
                        if ((length_code == 126 && data.length > 7) ||
                            (length_code == 127 && data.length > 14)) {
                            if (length_code == 126) {
                                length_code = data[2] * 256 + data[3];
                                mask = data.slice(4, 8);
                                data_start = 8;
                            } else if (length_code == 127) {
                                length_code = 0;
                                for (var i = 0; i < 8; i++) {
                                    length_code = length_code * 256 + data[2 + i];
                                }
                                mask = data.slice(10, 14);
                                data_start = 14;
                            }
                        } else {
                            length_code = -1; // Insufficient data to compute length
                        }
                    } else {
                        if (data.length > 5)
                            mask = data.slice(2, 6);
                    }

                    if (length_code > -1 && data.length >= data_start + length_code) {
                        var decoded = data.slice(data_start, data_start + length_code).map(function(byte, index) {
                            return byte ^ mask[index % 4];
                        });
                        data = data.slice(data_start + length_code);
                        if (fin && op > 0) {
                            // Unfragmented message.
                            if (!this.onFrame_(op, arrayBufferToString(decoded)))
                                return;
                        } else {
                            // Fragmented message.
                            fragmentedOp = fragmentedOp || op;
                            fragmentedMessage += arrayBufferToString(decoded);
                            if (fin) {
                                if (!this.onFrame_(fragmentedOp, fragmentedMessage))
                                    return;
                                fragmentedOp = 0;
                                fragmentedMessage = '';
                            }
                        }
                    } else {
                        break; // Insufficient data, wait for more.
                    }
                }
            };

            chrome.sockets.tcp.onReceive.addListener(onDataRead.bind(this));
            chrome.sockets.tcp.onReceiveError.addListener(onDataReadError.bind(this));
            chrome.sockets.tcp.setPaused(this.socketId, false);
        },

        onFrame_: function(op, data) {
            if (op == 1) {
                this.dispatchEvent('message', {'data': data});
            } else if (op == 8) {
                // A close message must be confirmed before the websocket is closed.
                if (this.readyState == 1) {
                    this.sendFrame_(8);
                } else {
                    this.close_();
                    return false;
                }
            }
            return true;
        },

        sendFrame_: function(op, data) {
            var WebsocketFrameString = function(op, str) {
                var length = str.length;
                if (str.length > 65535)
                    length += 10;
                else if (str.length > 125)
                    length += 4;
                else
                    length += 2;
                var lengthBytes = 0;
                var buffer = new ArrayBuffer(length);
                var bv = new Uint8Array(buffer);
                bv[0] = 128 | (op & 15); // Fin and type text.
                bv[1] = str.length > 65535 ? 127 :
                    (str.length > 125 ? 126 : str.length);
                if (str.length > 65535)
                    lengthBytes = 8;
                else if (str.length > 125)
                    lengthBytes = 2;
                var len = str.length;
                for (var i = lengthBytes - 1; i >= 0; i--) {
                    bv[2 + i] = len & 255;
                    len = len >> 8;
                }
                var dataStart = lengthBytes + 2;
                for (var i = 0; i < str.length; i++) {
                    bv[dataStart + i] = str.charCodeAt(i);
                }
                return buffer;
            }

            var array = WebsocketFrameString(op, data || '');
            chrome.sockets.tcp.send(this.socketId, array, function(sendInfo) {
                if (sendInfo.resultCode < 0 ||
                    sendInfo.bytesSent !== array.byteLength) {
                    this.close_();
                }
            }.bind(this));
        },

        close_: function() {
            chrome.sockets.tcp.disconnect(this.socketId);
            chrome.sockets.tcp.close(this.socketId);
            this.readyState = 3;
            this.dispatchEvent('close');
        }
    };

    return {
        'Server': HttpServer,
        'WebSocketServer': WebSocketServer,
    };
}();
