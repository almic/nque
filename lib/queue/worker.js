var EventEmitter = require('events').EventEmitter,
    redis = require('../redis.js'),
    events = require('./events.js'),
    Job = require('./job.js')

var clients = {}

var states = Job.states

exports = module.exports = Worker

// Shortcut to this.client.getKey(p)
function g(p){ return Worker.client.getKey(p) }

function Worker(queue, type) {
    this.queue = queue
    this.type = type
    this.client = Worker.client
    this.running = true
    this.job = null
}

Worker.prototype.__proto__ = EventEmitter.prototype

Worker.prototype.idle = function() {
    this.job = null
    this.emit('idle')
    return this
}

Worker.prototype.emitJobEvent = function(event, job, arg1, arg2) {
    if (this.cleaned) return
    events.emit(job.id, event, arg1, arg2)
    this.emit('job ' + event, job)
}

Worker.prototype.zpop = function(key, callback) {
    this.client.multi()
        .zrange(key, 0, 0)
        .zremrangebyrank(key, 0, 0)
        .exec((error, result) => {
            if (error || !result || !result[0] || !result[0].length) return callback(error)
            callback(undefined, (result[0][0] || result[0][1][0]))
        })
}

Worker.prototype.getJob = function(callback) {
    if (!this.running) return callback(`Worker ${this.id} is not running, unable to get a job`)
    var client = clients[this.type] || (clients[this.type] = redis.create())
    client.blpop(g(this.type + ':jobs'), 0, (error) => {
        if (error || !this.running) {
            // Do a double check!
            if (this.client && this.client.connected && !this.client.closing) {
                this.client.lpush(g(this.type + ':jobs'), 1)
            }
            return callback(error)
        }
        this.job = true
        this.zpop(g('jobs:' + this.type + ':' + states[1]), (error, id) => {
            if (error || !id) {
                this.idle()
                return callback(error)
            }
            Job.get(id, callback)
        })
    })
}

Worker.prototype.start = function(callback) {
    this.idle()
    if (!this.running) return
    
    this.getJob((error, job) => {
        if (error) this.emit('error', error, job)
        var self = this
        if (!job || error) return process.nextTick(() => {
            self.start(callback)
        })
        this.process(job, callback)
    })
    
    return this
}

Worker.prototype.failed = function(job, error, callback) {
    job.failedAttempt(error, (err, hasAttempts, attempt) => {
        if (err) return this.emit('error', err, job)
        if (hasAttempts) {
            this.emitJobEvent('failed attempt', job, error, attempt)
        } else {
            this.emitJobEvent('failed', job, error)
        }
        this.start(callback)
    })
}

Worker.prototype.process = function(job, callback) {
    if (typeof callback !== 'function') callback = function(){}
    
    this.job = job
    job.hset('workerId', job.workerId = this.id)
    
    var self = this
    var done = (error, result) => {
        if (self.drop_calls) return;
        if (self.job === null || self.job && self.job.id && self.job.id !== job.id) return;
        if (error) return self.failed(job, error, callback)
        if (result) {
            job.result = result
            job.hset('result', JSON.stringify(result))
        }
        job.complete(() => {
            job.attempt(() => {
                if (job.removeOnComplete) {
                    job.remove()
                }
                self.emitJobEvent('complete', job, result)
                self.start(callback)
            })
        })
    }
    
    job.active(() => {
        self.emitJobEvent('start', job, job.type)
        callback(job, done)
    })
    return this
}

Worker.prototype.shutdown = function(timeout, callback) {
    var shutdownTimer = null
    if (typeof timeout === 'function') {
        callback = timeout
        timeout = null
    }
    
    var cb = function(job) {
        if (job && this.job && job.id != this.job.id) return;
        if (shutdownTimer) clearTimeout(shutdownTimer)
        this.removeAllListeners()
        this.job = null
        (this.type in clients) && clients[this.type].quit()
        delete clients[this.type]
        self.cleaned = true
        this.client.lpush(g(self.type + ':jobs'), 1, callback)
    }
    
    if (!this.running) return cb()
    this.running = false
    
    if (!this.job) return cb()
    this.on('idle', cb)
    this.on('job complete', cb)
    this.on('job failed', cb)
    this.on('job failed attempt', cb)
    
    if (timeout) {
        shutdownTimer = setTimeout(() => {
            if (this.job) {
                this.drop_calls = true
                this.removeAllListeners()
                if (this.job === true) {
                    this.once('idle', cb)
                } else {
                    this.once('job failed', cb)
                    this.once('job failed attempt', cb)
                    this.failed(this.job, new Error('shutting down'))
                }
            } else {
                cb()
            }
        }, timeout)
    }
    
}
