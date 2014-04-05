
var Base = require('noflo-runtime-base');

function WebSocketRuntime (options) {
    if (!options) {
        options = {};
    }
    this.connections = [];

    if (options.captureOutput) {
        this.startCapture();
    }

    this.prototype.constructor.apply(this, arguments);
    this.receive = this.prototype.receive;
}
WebSocketRuntime.prototype = Base;
WebSocketRuntime.prototype.send = function (protocol, topic, payload, context) {
    if (!context.connection)
        return;

    context.connection.send(JSON.stringify({
        protocol: protocol,
        command: topic,
        payload: payload
    }));
};

WebSocketRuntime.prototype.startCapture = function () {
};

WebSocketRuntime.prototype.stopCapture = function () {
};

var runtime = function (httpServer, options) {
    var wsServer = new http.WebSocketServer(httpServer);
    var context = {};

    var runtime = new WebSocketRuntime(options);
    var handleMessage = function (message, connection) {
        try {
            var contents = JSON.parse(message.data);
        } catch (e) {
            return;
        }
        context.connection = connection;
        runtime.receive(contents.protocol, contents.command, contents.payload, context);
    };

    wsServer.addEventListener('request', function (request) {
        var connection = request.accept('noflo', request.origin);
        runtime.connections.push(connection);
        connection.addEventListener('message', function (message) {
            handleMessage(message, connection);
        });
        connection.addEventListener('close', function () {
            console.log('disconnected');
            if (runtime.connections.indexOf(connection) === -1) {
                return;
            }
            if (context.connection == connection)
                context.connection = null;
            runtime.connections.splice(runtime.connections.indexOf(connection), 1);
        });

        console.log('connected');

        return true;
    });

    return runtime;
};

/**/

var baseDir = '/noflo-chrome';
var host = 'localhost';
var port = 5555;
var interval = 10 * 60 * 1000;

var server = new http.Server();
var rt = runtime(server, {
    baseDir: baseDir,
    captureOutput: false,
    catchExceptions: true
});

var NoFlo = require('noflo-chrome');
var loader = new NoFlo.ComponentLoader('/noflo-chrome');
console.log('listing components');
loader.listComponents(function(components) {
    console.log('components : ');
    console.log(components);
    console.log('done.');
});

server.listen(port);
