'use strict';

var restify = require('restify');
var bunyan = require('bunyan');
var errors = require('restify-errors');

var HttpError = errors.HttpError;
var corsMiddleware = require('restify-cors-middleware');

const cors = corsMiddleware({
    preflightMaxAge: 5, //Optional
    origins: ['*', 'http://api.myapp.com', 'http://web.myapp.com'],
    allowHeaders: ['API-Token'],
    exposeHeaders: ['API-Token-Expiry']
});


/**
 * Start server
 * @param appName {String} application name
 * @param port {Number}
 * @param logger {*} bunyan logger
 * @returns {*} server
 */
function startServer(appName, port, logger) {
    var server;
    if (!appName) {
        throw new TypeError("Require parameter appName in startServer(appName,port,logger)");
    }
    if (!logger) {
        throw new TypeError("Require parameter logger in startServer(appName,port,logger)");
    }
    if (!port) {
        throw new TypeError("Require parameter port in startServer(appName,port,logger)");
    }
    server = restify.createServer({name: appName, log: logger});
    server.listen(port, function () {
        logger.info('Server started %s', server.url);
    });
    server.pre(cors.preflight);
    server.use(cors.actual);
    server.use(restify.plugins.acceptParser(server.acceptable));
    server.use(restify.plugins.queryParser({mapParams: true}));
    server.use(restify.plugins.bodyParser({mapParams: true}));

    _initCommonRoutes(server);
    _initErrorHandler(server);

    return server;


    /**
     * Basic routes
     * @param server
     * @private
     */
    function _initCommonRoutes(server) {
        server.get("/_status", function _getServerStatus(req, res, next) {
            res.send({status: "OK", info:server.getDebugInfo()});
        });
        /**
         * List all registered routes
         * http://stackoverflow.com/questions/24962005/how-to-get-list-of-all-routes-i-am-using-in-restify-server
         * @param server
         * @returns {{GET: Array, PUT: Array, DELETE: Array, POST: Array}}
         */
        server.get("/api/admin/_routes", function _listDefinedRoutes(req, res, next) {
            var result = {"GET": [], "PUT": [], "DELETE": [], "POST": []};
            Object.keys(result).forEach(function (key) {
                server.router.routes[key].forEach(function (value) {
                    result[key].push(value.spec.path);
                });
            });
            res.send(result);
        });
    }

    function _initErrorHandler(server) {
        /**
         * http://mcavage.me/node-restify/#error-handling
         */
        server.on("uncaughtException", function serverUncaughtExp(req, res, route, err) {
            logger.error(err, "uncaughtException");
            res.send(err);
        });
        process.on("uncaughtException", function processUncaughtExp(err) {
            var msg = "Uncaught fatal exception, process will exit now.";
            logger.fatal(err, msg);
            process.exit(1);
        });
    }
}

/**
 * Returns a Bunyan audit logger suitable to be used in a server.on('after')
 * event.  I.e.:
 *
 * server.on('after', restify.auditLogger({ log: myAuditStream }));
 *
 * This logs at the INFO level.
 *
 * @param {Object} options at least a bunyan logger (log).
 * @return {Function} to be used in server.after.
 */
function auditLogger(options) {
    //assert.object(options, 'options');
    //assert.object(options.log, 'options.log');
    var errSerializer = bunyan.stdSerializers.err;

    if (options.log.serializers && options.log.serializers.err) {
        errSerializer = options.log.serializers.err;
    }

    var log = options.log.child({
        audit: true,
        serializers: {
            err: errSerializer,
            req: function auditRequestSerializer(req) {
                if (!req)
                    return (false);

                var timers = {};
                (req.timers || []).forEach(function (time) {
                    var t = time.time;
                    //LEO: t is high-resolution real time in format of [seconds, nanoseconds], we convert it to ms
                    //var _t = Math.floor((1000000 * t[0]) + (t[1] / 1000));
                    var _t = Math.floor((1000 * t[0]) + (t[1] / 1000000));
                    timers[time.name] = _t;
                });
                return ({
                    method: req.method,
                    url: req.url,
                    //headers: req.headers,
                    //httpVersion: req.httpVersion,
                    //trailers: req.trailers,
                    //version: req.version(),
                    //body: options.body === true ?
                    //    req.body : undefined,
                    timers: timers
                });
            },
            res: function auditResponseSerializer(res) {
                if (!res)
                    return (false);


                var body;
                if (options.body === true) {
                    if (res._body instanceof HttpError) {
                        body = res._body.body;
                    } else {
                        //body = res._body;
                        body = res._body;
                    }
                }

                return ({
                    statusCode: res.statusCode,
                    //headers: res._headers,
                    //trailer: res._trailer || false,
                    body: body
                });
            }
        }
    });

    function audit(req, res, route, err) {
        var latency = res.get('Response-Time');
        if (typeof (latency) !== 'number')
            latency = Date.now() - req._time;
        var obj = {
            //remoteAddress: req.connection.remoteAddress,
            //remotePort: req.connection.remotePort,
            //req_id: req.getId(),
            req: req,
            res: res,
            err: err,
            latency: latency
            //secure: req.secure,
            //_audit: true
        };

        log.info(obj, 'handled: %d', res.statusCode);

        return (true);
    }

    return (audit);
}

module.exports = {
    startServer: startServer
};
