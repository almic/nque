var EventEmitter = require('events').EventEmitter,
    events = require('./events.js'),
    redis = require('../redis.js')

exports = module.exports = Job

var priorities = exports.priorities = {
    high:   5,
    medium: 4,
    normal: 3,
    low:    2,
    none:   1
}

var states = exports.states = [
    'delayed',  // 0 -  Delayed;  set but not ready to start
    'pending',  // 1 -  Pending;  ready to start
    'active',   // 2 -   Active;  started by worker
    'complete', // 3 - Complete;  result determined or otherwise done
    'failed'    // 4 -   Failed;  error thrown during execution, result contains error
]

var jobDefaults = exports.jobDefaults = {
    id: 0,
    type: 'job',
    data: {},
    result: {},
    priority: priorities.normal,
    state: states[1],
    created: +new Date(),
    finished: undefined,
    removeOnComplete: true,
    workerId: undefined,
    attempts: 0,
    maxAttempts: 1,
    timeout: 1000,
    delay: 0
}

function _map(jobs, ids) {
    var result = []
    ids.forEach(id => {
        if (jobs[id]) result.push(jobs[id])
    })
    return result.sort((a, b) => {
        return parseInt(a.id) - parseInt(b.id)
    })
}

// Shortcut to this.client.getKey(p)
function g(p){ return Job.client.getKey(p) }

exports.get = function(id, type, callback) {
    if (typeof type === 'function') {
        callback = type
        type = ''
    }
    if (!Number.isSafeInteger(parseInt(id))) {
        return callback(new Error('invalid id'))
    }
    Job.client.hgetall(g('job:' + id), (error, job) => {
        if (error) return callback(error)
        if (!job) {
            exports.removeBadJob(id, type)
            return callback(new Error(`job '${id}' not found`))
        }
        if (!job.type) {
            exports.removeBadJob(id, type)
            return callback(new Error(`job '${id}' was half-baked`))
        }
        callback(error, new Job(job))
    })
}

exports.removeBadJob = function(id, type) {
    Job.client.multi()
        .del(g('job:' + id))
        .zrem(g('jobs:' + states[0]), id)
        .zrem(g('jobs:' + states[1]), id)
        .zrem(g('jobs:' + states[2]), id)
        .zrem(g('jobs:' + states[3]), id)
        .zrem(g('jobs:' + states[4]), id)
        .zrem(g('jobs'), id)
        .zrem(g('jobs:' + type + states[0]), id)
        .zrem(g('jobs:' + type + states[1]), id)
        .zrem(g('jobs:' + type + states[2]), id)
        .zrem(g('jobs:' + type + states[3]), id)
        .zrem(g('jobs:' + type + states[4]), id)
        .exec()
}

exports.remove = function(id, callback) {
    if (typeof callback !== 'function') callback = function(){}
    exports.get(id, (error, job) => {
        if (error) return callback(error)
        if (!job) return callback(new Error(`failed to find job ${id}`))
        job.remove(callback)
    })
}

function Job(type, data) {
    if (typeof type === 'object') {
        // Coerce to Job
        for (var prop in type) {
            if (jobDefaults.hasOwnProperty(prop)) {
                if (typeof type[prop] === typeof jobDefaults[prop]) {
                    this[prop] = type[prop]
                } else {
                    switch (typeof jobDefaults[prop]) {
                        case 'boolean': {
                            if (type[prop] === 'true') {
                                this[prop] = true
                                break
                            } else if (type[prop] === 'false') {
                                this[prop] = false
                                break
                            } 
                        }
                        case 'number': {
                            if (parseInt(type[prop]).toString() === type[prop]) {
                                this[prop] = parseInt(type[prop])
                                break
                            }
                        }
                        case 'object': {
                            try {
                                this[prop] = JSON.parse(type[prop])
                                break
                            } catch (e) { /* Do nothing */ }
                        }
                        default: {
                            throw new Error(`Property '${prop}' of object is not like '${typeof jobDefaults[prop]}'`)
                        }
                    }
                }
            } else if (type.hasOwnProperty(prop)) {
                // Attempting to set property which isn't settable
                console.warn(`Passed property '${prop}' can't be set for Job. See Job.jobDefaults for a list of settable properties.`)
            }
        }
    } else if (typeof type === 'string') {
        for (var prop in jobDefaults) {
            if (jobDefaults.hasOwnProperty(prop)) {
                this[prop] = jobDefaults[prop]
            }
        }
        this.type = type
    }
    if (data) this.data = data
    this.client = Job.client
    this.on('error', (error) => { console.error(error) })
}

Job.prototype.__proto__ = EventEmitter.prototype

Job.prototype.getObject = function() {
    return {
        id: this.id,
        type: this.type,
        data: this.data,
        result: this.result,
        priority: this.priority,
        state: this.state,
        created: this.created,
        finished: this.finished,
        removeOnComplete: this.removeOnComplete,
        workerId: this.workerId,
        attempts: this.attempts,
        maxAttempts: this.maxAttempts,
        timeout: this.timeout,
        delay: this.delay
    }
}

Job.prototype.hset = function(key, val, callback) {
    if (typeof callback !== 'function') callback = function(){}
    this.client.hset(g('job:' + this.id), key, val, callback)
    return this
}

Job.prototype.hget = function(key, callback) {
    if (typeof callback !== 'function') callback = function(){}
    this.client.hget(g('job:' + this.id), key, callback)
    return this
}

Job.prototype.setPriority = function(priority, callback) {
    if (typeof callback !== 'function') callback = function(){}
    if (Number.isSafeInteger(priority)) {
        this.priority = Math.max(Math.min(priority, 5), 1) // Clip to range 1-5
    } else if (typeof priority === 'string') {
        this.priority = priorities[priority] || priorities.normal
    } else {
        this.priority = priorities.normal
    }
    
    if (this.priority != priority && this.priority != priorities[priority]) {
        console.warn(`Priority was clipped for job ${job.id}, outside range 1-5 (${priority})`)
    }
    
    this.hset('priority', this.priority, (error) => {
        if (!error) {
            callback(this.priority)
        } else {
            events.emit(this.id, 'error', new Error(`Redis error while setting job ${this.id} priority to '${this.priority}': ${error}`))
        }
    })
    
    return this
}

Job.prototype.setState = function(state, callback) {
    if (typeof callback !== 'function') callback = function(){}
    
    if (!states.includes(state)) {
        console.warn(`Attempted to set job ${this.id} state to '${state}', which is an invalid state. See Job.states for a list of possible states. Defaulting to 'delayed'`)
        state = states[0] // Default to a delayed state
    }

    var oldState = state
    var multi = this.client.multi()
    if (oldState != this.state) {
        multi
            .zrem(g('jobs:' + oldState), this.id)
            .zrem(g('jobs:' + this.type + ':' + oldState), this.id)
    }
    multi
        .hset(g('job:' + this.id), 'state', state)
        .zadd(g('jobs:' + state), this.priority, this.id)
        .zadd(g('jobs:' + this.type + ':' + state), this.priority, this.id)
    
    if (state === states[1]) multi.lpush(g(this.type + ':jobs'), 1)
    
    multi.exec((error) => {
        if (!error) {
            this.state = state
            // Pending, emit enqueue
            if (state === states[1]) {
                events.emit(this.id, 'enqueue', this.type)
            }
            callback(this.state)
        } else {
            events.emit(this.id, 'error', new Error(`Redis error while setting job ${this.id} state to '${state}': ${error}`))
        }
    })
    return this
}

Job.prototype.setTimeout = function(ms, callback) {
    if (typeof callback !== 'function') callback = function(){}
    if (Number.isSafeInteger(ms)) {
        this.timeout = ms
    } else {
        events.emit(this.id, 'error', new Error(`Timeout value '${ms}' is not a valid integer.`))
    }
    return this
}

Job.prototype.apply = function(callback) {
    if (typeof callback === 'function') {
        // Wrap callback to pass new this
        var self = this
        var ncb = () => { callback(null, self) }
    }
    this.hset('delay', this.delay)
    this.hset('timeout', this.timeout)
    this.setPriority(this.priority)
    this.hset('removeOnComplete', this.removeOnComplete)
    this.hset('data', JSON.stringify(this.data))
    this.setState(this.state, ncb)
    this.client.zadd(g('jobs'), this.priority, this.id)
    return this
}

Job.prototype.attempt = function(callback) {
    if (typeof callback !== 'function') callback = function(){}
    if (this.attempts < this.maxAttempts) {
        this.client.hincryby(g('job:' + this.id), 1, (error, attempts) => {
            this.attempts = attempts
            callback(error, this.maxAttempts - attempts, attempts, this.maxAttempts)
        })
    } else {
        callback(undefined, 0, this.attempts, this.maxAttempts)
    }
    return this
}

Job.prototype.reattempt = function(callback) {
    if (typeof callback !== 'function') callback = function(){}
    var self = this
    this.setDelay(this.timeout).update(error => {
        if (error) return callback(error)
        self.delayed(callback)
    })
}

Job.prototype.failedAttempt = function(error, callback) {
    if (typeof callback !== 'function') callback = function(){}
    events.emit(this.id, 'error', error)
    this.failed(() => {
        this.attempt((error, remaining, attempts) => {
            if (error) return callback(error)
            if (remaining > 0) {
                this.reattempt(error => {
                    if (error) return callback(error)
                    callback(error, true, attempts)
                })
            } else {
                callback(undefined, false, attempts)
            }
        })
    })
    return this
}

Job.prototype.remove = function(callback) {
    if (typeof callback !== 'function') callback = function(){}
    this.client.multi()
        .zrem(g('jobs:' + this.state), this.id)
        .zrem(g('jobs:' + this.type + ':' + this.state), this.id)
        .zrem(g('jobs'), this.id)
        .del(g('job:' + this.id))
        .exec(error => {
            events.emit(this.id, 'remove', this.type)
            callback(error)
        })
    return this
}

Job.prototype.complete = function(callback) {
    return this.hset('finished', +new Date()).setState(states[3], callback)
}

Job.prototype.failed = function(callback) {
    return this.hset('finished', +new Date()).setState(states[4], callback)
}

Job.prototype.pending = function(callback) {
    return this.setState(states[1], callback)
}

Job.prototype.active = function(callback) {
    return this.setState(states[2], callback)
}

Job.prototype.delayed = function(callback) {
    return this.setState(states[0], callback)
}

Job.prototype.run = function(callback) {
    // Shortcut to instantly set job to pending
    this.state = states[1]
    this.save(callback)
}

Job.prototype.save = function(callback) {
    if (typeof callback !== 'function') callback = function(){}
    
    if (this.id) return this.apply(callback)
    var self = this
    this.client.incr(g('ids'), (error, id) => {
        if (error) return callback(error)
        self.id = id
        events.add(this, () => {
            self.hset('maxAttempts', self.maxAttempts)
            self.hset('type', self.type)
            self.hset('created', self.created)
            self.hset('id', self.id)
            self.client.sadd(g('job:types'), self.type)
            self.apply(callback)
        })
    })
    return this
}
