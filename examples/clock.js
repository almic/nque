const nque = require('../')

var queue = nque.createQueue(process.env.REDIS_URL)

// Set a custom error listener, otherwise errors are simply printed to the console
queue.on('error', (error) => {
    console.error(`Got an error: ${error}`)
    // Maybe terminate your script for certain errors?
})

var type = 'example-test'
var data = ['hello', 'world']

var makeJob = function(type, data) {
    
    console.log('Creating job!')
    var job = queue.createJob(type, data)
    
    // You can change settings by manually altering the Job properties
    job.priority = 5
    job.state = 'delayed' // This is only for example, it won't change anything later
    
    // - Optionally call
//  job.apply()
    // - to immediately update the job on redis with current options
    
    // Call job.run() to set job.state to pending and trigger workers
    job.run((error, job) => {
        // Optional callback for error handling and logging.
        console.log(`Job ${job.id} created!\n`)
    })
}

// Creates the job every 5 seconds, and stops after about 3 jobs
var interval = setInterval(makeJob, 5000, type, data)

setTimeout(clearInterval, 15100, interval)
