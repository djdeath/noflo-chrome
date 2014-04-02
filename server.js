
//var http = require('http');
console.log(http);
//var lhttp = http();
var Base = require('noflo-runtime-base');

function WebSocketRuntime (options) {
  if (!options) {
    options = {};
  }
  this.connections = [];
  // if (options.catchExceptions) {
  //   process.on('uncaughtException', function (err) {
  //     this.connections.forEach(function (connection) {
  //       this.send('network', 'error', {
  //         message: err.toString()
  //       }, {
  //         connection: connection
  //       });
  //     }.bind(this));
  //   }.bind(this));
  // }

  if (options.captureOutput) {
    this.startCapture();
  }

  this.prototype.constructor.apply(this, arguments);
  this.receive = this.prototype.receive;
}
WebSocketRuntime.prototype = Base;
WebSocketRuntime.prototype.send = function (protocol, topic, payload, context) {
  if (!context.connection || !context.connection.connected) {
    return;
  }
  context.connection.sendUTF(JSON.stringify({
    protocol: protocol,
    command: topic,
    payload: payload
  }));
};

WebSocketRuntime.prototype.startCapture = function () {
  // this.originalStdOut = process.stdout.write;
  // process.stdout.write = function (string, encoding, fd) {
  //   this.connections.forEach(function (connection) {
  //     this.send('network', 'output', {
  //       message: string.replace(/\n$/, '')
  //     }, {
  //       connection: connection
  //     });
  //   }.bind(this));
  // }.bind(this);
};

WebSocketRuntime.prototype.stopCapture = function () {
  // if (!this.originalStdOut) {
  //   return;
  // }
  // process.stdout.write = this.originalStdOut;
};

var runtime = function (httpServer, options) {
  var wsServer = new http.WebSocketServer(httpServer);

  var runtime = new WebSocketRuntime(options);
  var handleMessage = function (message, connection) {
    if (message.type == 'utf8') {
      try {
        var contents = JSON.parse(message.utf8Data);
      } catch (e) {
        return;
      }
      runtime.receive(contents.protocol, contents.command, contents.payload, {
        connection: connection
      });
    }
  };

  wsServer.addEventListener('request', function (request) {
    var connection = request.accept('noflo', request.origin);
    runtime.connections.push(connection);
    connection.addEventListener('message', function (message) {
      handleMessage(message, connection);
    });
    connection.addEventListener('close', function () {
      if (runtime.connections.indexOf(connection) === -1) {
        return;
      }
      runtime.connections.splice(runtime.connections.indexOf(connection), 1);
    });
  });

  return runtime;
};

/**/

var baseDir = '/noflo-chrome';
var host = 'localhost';
var port = 5555;
var interval = 10 * 60 * 1000;

var server = new http.Server();
console.log(server);
var rt = runtime(server, {
  baseDir: baseDir,
  captureOutput: false,
  catchExceptions: true
});
console.log('runtime operating!');

var NoFlo = require('noflo');
var loader = new NoFlo.ComponentLoader('/noflo-chrome');
console.log('listing components');
loader.listComponents(function(components) {
    console.log(components);
});

console.log('listening');
server.listen(port);// , function () {
//   console.log('NoFlo runtime listening at ws://' + host + ':' + port);
//   console.log('Using ' + baseDir + ' for component loading');
// });
console.log('listened');
