var redis = require('redis')

exports = module.exports

exports.config = function(connection, queue) {
    if (typeof connection !== 'string' && typeof connection !== undefined) {
        throw new Error('Please use a redis connection string, or pass nothing for a local server')
    }
    
    exports.reset()
    
    exports.create = function() {
        var client = redis.createClient(connection)
        client.select(0)
        client.on('error', error => { queue.emit('error', error) })
        client.prefix = 'nque'
        
        client.getKey = function( key ) {
            if (client.constructor.name == 'Redis' || client.constructor.name == 'Cluster') {
                return '{' + this.prefix + '}:' + key
            }
            return this.prefix + ':' + key
        };
        
        return client
    }
    
}

exports.client = function() {
    return exports._client || (exports._client = exports.create())
}

exports.reset = function() {
    if (exports._client) exports._client.quit()
    exports._client = null
}
