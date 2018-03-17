var redis = require('../redis')

exports.jobs = {}
exports.key = 'events'
exports.callbackQueue = []

exports.emit = function(id, event) {
    var client = redis.client(),
        msg = JSON.stringify({ id: id, event: event, args: [].slice.call(arguments, 1) })
    client.publish(client.getKey(exports.key), msg, function(){})
}

exports.add = function(job, callback) {
    if (job.id) {
        if (!exports.jobs[job.id]) exports.jobs[job.id] = []
        exports.jobs[job.id].push(job)
    }
    if (!exports.subscribeStarted ) exports.subscribe()
    if (!exports.subscribed) exports.callbackQueue.push(callback)
    else callback()
}

exports.remove = function(job) {
  delete exports.jobs[job.id]
}

var onMessage = function(channel, msg) {
  msg = JSON.parse(msg)

  var jobs = exports.jobs[msg.id]
  if (jobs && jobs.length > 0) {
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i]
      job.emit.apply(job, msg.args)
      if ([ 'complete', 'failed' ].indexOf(msg.event) !== -1) exports.remove(job)
    }
  }
  
  msg.args[0] = 'job ' + msg.args[0]
  msg.args.splice(1, 0, msg.id)
  if (exports.queue) exports.queue.emit.apply(exports.queue, msg.args)
}

exports.subscribe = function() {
    if (exports.subscribeStarted) return;
    var client = redis.create()
    client.on('message', onMessage)
    client.subscribe(client.getKey(exports.key), function() {
        exports.subscribed = true
        while (exports.callbackQueue.length) {
            process.nextTick(exports.callbackQueue.shift())
        }
    })
    exports.queue = require('../nque').singleton
    exports.subscribeStarted = true
}

exports.unsubscribe = function() {
  var client = redis.create()
  client.unsubscribe()
  client.removeAllListeners()
  exports.subscribeStarted = false
}
