const nque = require('../')

var queue = nque.createQueue(process.env.REDIS_URL)

// Set a custom error listener, otherwise errors are simply printed to the console
queue.on('error', (error) => {
    console.error(`Got an error: ${error}`)
    // Maybe terminate your script for certain errors?
})

var type = 'example-test'
var method = function(job, done) {
    console.log(`\nJob ${job.id} retrieved!\n`)
    
    var data = job.data
    console.log(`Job data: ${JSON.stringify(data)}\n`)
    
    var result = data.join(' ')
    
    done(null, result)
}

console.log('Listening for jobs!\n')
queue.processJob(type, method)
