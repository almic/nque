var EventEmitter = require('events').EventEmitter,
    redis = require('./redis.js'),
    Warlock = require('./warlock.js'),
    events = require('./queue/events.js'),
    Job = require('./queue/job.js'),
    Worker = require('./queue/worker.js')

exports = module.exports = Queue

exports.createQueue = function(connection) {
    if (!Queue.singleton) {
        Queue.singleton = new Queue(connection)
    }
    events.subscribe()
    return Queue.singleton
}

exports.workers = []

function Queue(connection) {
    this.name = 'nque'
    this.id = ['nque', require('os').hostname(), process.pid].join(':')
    this.workers = exports.workers
    this.shuttingDown = false
    redis.config(connection, this)
    this.on('error', error => { console.error(error) })
    this.client = Worker.client = Job.client = redis.create()
}

Queue.prototype.__proto__ = EventEmitter.prototype

Queue.prototype.on = function(event) {
    if (event.indexOf('job') === 0) events.subscribe()
    return EventEmitter.prototype.on.apply(this, arguments)
}

Queue.prototype.createJob = function(type, data) {
    return new Job(type, data)
}

Queue.prototype.processJob = function(type, concurrency, callback) {
    var self = this
    var worker
    
    if (typeof concurrency === 'function') {
        callback = concurrency
        concurrency = 1
    }
    
    while (concurrency--) {
        worker = new Worker(self, type).start(callback)
        worker.id = [self.id, type, self.workers.length + 1].join(':')
        worker.on('error', error => {
            self.emit('error', error)
        })
        self.workers.push(worker)
    }
    this.setup()
}

Queue.prototype.setup = function() {
    if (!this.warlock) {
        this.lockClient = redis.create()
        this.warlock = new Warlock(this.loclClient)
    }
}

Queue.prototype.shutdown = function(timeout, type, callback) {
    var self = this
    var numw = self.workers.length
    if (typeof type === 'function') {
        callback = type
        type = ''
    }
    if (typeof timeout === 'function') {
        callback = timeout
        type = ''
    }
    if (typeof timeout !== 'number') { timeout = null
    } else { timeout = timeout.toFixed(0) } // Force integer ms
    
    if (typeof callback !== 'function') callback = function(){}
    
    if (this.shuttingDown && type === '') return callback(new Error('Already shutting down'))
    
    var o_callback = callback
    
    if (type === '') this.shuttingDown = true
    
    var clean = function() {
        if (self.shuttingDown) {
            self.workers = []
            exports.workers = []
            self.removeAllListeners()
            Queue.singleton = null
            events.unsubscribe()
            redis.reset()
            if (self.client) {
                self.client.quit()
                self.client = null
            }
            if (self.lockClient) {
                self.lockClient.quit()
                self.lockClient = null
            }
        }
    }
    
    callback = function(error) {
        if (error) return o_callback(error)
        if (!--numw) {
            clean()
            o_callback.apply(null, arguments)
        }
    }
    
    if (!self.workers.length) {
        clean()
        o_callback()
    } else {
        self.workers.forEach(worker => {
            if (self.shuttingDown || worker.type == type) {
                worker.shutdown(timeout, callback)
            } else {
                callback()
            }
        })
    }
    
}

Queue.prototype.state = function(state, callback) {
    this.client.zrange(this.client.getKey('jobs:' + state), 0, -1, callback)
}

Queue.prototype.complete = function(callback) {
    this.state('complete', callback)
}

Queue.prototype.failed = function(callback) {
    this.state('failed', callback)
}

Queue.prototype.pending = function(callback) {
    this.state('pending', callback)
}

Queue.prototype.active = function(callback) {
    this.state('active', callback)
}

Queue.prototype.delayed = function(callback) {
    this.state('delayed', callback)
}
