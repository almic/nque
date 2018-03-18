# Nque

[![NPM](https://nodei.co/npm/nque.png?compact=true)](https://nodei.co/npm/nque/)

Nque is a simple job queue that uses redis, now with **98% less package!** 

I made this because I needed a quick solution for job queuing and the best one I could find was Kue, but it added 20Mb to my modules folder. I wasn't about to have that, so I gutted out all the extra stuff, made some improvements and simplified the API. Again, this is a fork of Kue, heavily gutted to suite my needs. Don't complain how this is basically a less featured version of Kue, because *that is the point.*

## Quick Start
`main.js`
```javascript
const nque = require('nque')

// Configure the queue
var queue = nque.createQueue('redis://...')

// Create a new job and pass some data
var job = queue.createJob('my job', ['hello', 'world'])

// Tell workers the job is ready
job.run()
```
And then in<br>`worker.js`
```javascript
const nque = require('nque')

// Configure the queue
var queue = nque.createQueue('redis://...')

// Create the worker process
queue.processJob('my job', (job, done) => {
    
    // Get the job data: ['hello', 'world']
    var data = job.data
    
    // Do worker magic...
    var result = data.join(' ') + '!'
    console.log(`Job ${job.id} result: ${result}`)\
    
    // Job is done, go back to waiting
    done()
    
})
```

## About

If you only need a simple solution to queue jobs and want to keep learning a new module to a minimum, Nque is perfect!

**PROTIP** This is NOT Kue! The API is quite different and much simpler. This allows you to quickly link two separate processes together, which let's you create a very powerful clock/ worker(s) structure in only a couple lines.

I wrote this particularly for a clock/ workers structure. You write a clock process that simply queues job at specific intervals, and multiple duplicate worker processes that simply listen for jobs and do them in the background. I needed this structure for a Heroku Node.js app.

I recommend using a MongoDB to store your results, since it is much more featured than redis. This only uses redis because it's fast and easy to write, but not very easy to query. With MongoDB you get natural backups and a "clos*er* to javascript" API experiece. I don't know why I put that in quotes.


## Features

  - Simple job creation with data
  - Simple job processing
  - Powered by Redis (is that a *feature* though?)

## Guide

  - [Redis Connection](#redis-connection)
  - [Queues](#queues)
    - [Events](#events)
  - [Jobs](#jobs)
    - [Creating Jobs](#creating-jobs)
    - [Processing Jobs](#processing-jobs)
    - [Concurrent Job Processing](#concurrent-job-processing)
    - [Methods](#methods)
    - [Events](#events-1)
    - [Properties](#properties)
  - [Bugs](#bugs)

## Redis Connection

In order to make use of this module, you need a working Redis database. I run my app on Heroku, so getting one set up is as easy as [installing the free add-on](https://devcenter.heroku.com/articles/heroku-redis). If you aren't using Heroku, you'll need to find some other way to get Redis up and running.

Once you have Redis going, just copy the connection url and put that in you environment variables. You can do this by using the [dotenv](https://www.npmjs.com/package/dotenv) package, just follow their instructions to set it up.

## Queues

Before you can do anything else, you have to first create a `queue` with either of the following:

```javascript
var nque = require('nque')

var queue = nque.createQueue(process.env.REDIS_URL)
  
// Or simply
var queue = require('nque').createQueue(process.env.REDIS_URL)
```

### Events

`queue.on('error')`

Queues only really have this event. By default any errors are simply written to the console with `console.error()`, but you can change it to whatever you want. The default is in place because a common error event is when the redis times out and a reconnection occasionally fails. This failure is due to the [redis](https://www.npmjs.com/package/redis) package, not Nque.

## Jobs

#### Small note:
> Jobs are the meat and potatoes of Nque. It's how you pass data from one process to another, and triggering background work. Since I use Heroku, this makes creating a Clock/ Worker(s) structure incredibly easy. The clock process queues jobs at very specific intervals, and an army of workers are standing by to pick them up and start working.
> 
> Or you can simply set up jobs based on user interactions. If you want to send an email, but want the web process to be free, you can simply create a job and pass the address. That way you can respond to requests faster and offload your mail client from the request handler onto your workers.
> 
> I recommend using MongoDB for actually storing your results, since it is much easier to query than Redis and has far more intuitive features. This way your Redis database is free and clean. As jobs are constantly added and removed, you don't really have to worry about write errors where a job never got properly queued due to storage limitations.
>
> You should have a whole separate process running to do jobs. This let's you scale up workers by having multiple running that all have the same code. This is mainly to allow other processes to create jobs, and have a single file that handles them, a *worker*. Running multiple *workers* let's you process jobs faster and has built in crash redundancy. If one worker fails and crashes, you still have multiple others that can keep handling jobs.

## Creating Jobs

Once you have a queue, you can create jobs very easily.

```javascript
queue.createJob('my job', {my: 'data', hello: 'world'}).run()
```

This quickly creates and marks a job as "ready-to-go." Jobs are objects though, with many properties that you can change. There are only two methods you need to worry about, `apply()` and `run()`. More on those later.

## Processing Jobs

To process jobs as they come, simply get the queue and...

```javascript
queue.processJob('my job', (job, done) => {
    var data = job.data // second parameter in createJob()
    console.log(`Hello ${data.hello}!`) // The work
    done() // Tells worker this job is done and to process the next one
})
```

You MUST call `done()` or else the next job will never start. You can theoretically call this immediately to process jobs as fast as possible, but this could result in new jobs crashing the worker before the current one finishes.

Why have this requirement? It let's you process jobs atomically and predictably. If you need to process more than one type at a time, you can do so like this:

## Concurrent Job Processing

```javascript
queue.processJob('my job', 10, (job, done) => {
    // work...
})
```

The second argument now defines the max number of jobs that can be processed by the same worker. If you create 10 types of `my job` in one process all at the same time, then this method let's you run all 10 at once, instead of one at a time.

This can be good for jobs that take a long time to run, and when doing one at a time is unnecessary. This might let you define a maximum number of jobs to process. If you do not call `done()`, and define a concurrency of 5, you can limit the job processing to 5 jobs total. This may be useful in some cases, but you should define some other way to limit jobs. And, if you are doing this, perhaps this solution is the wrong way to go. Limiting the number of jobs *created* is much better.

## Methods

Jobs have only four methods you need to worry about, `save()`, `apply()`, `run()` and `remove()`

#### `save()`
```javascript
job.save()
```

This method creates the job id and stores it in `job.id`, as well as saving all other properties to Redis. You can only call this once. As soon as the `id` is set, it becomes synonymous to calling `apply()`. If the job state is `pending`, then it will trigger workers when run.

#### `apply()`
```javascript
job.priority = 1
job.data = 'some stuff'
job.data += ', more stuff'
job.apply()
```

This method will automatically save the new job properties to Redis. There are only some properties that can be updated after `save()`, these currently include `timeout`, `priority`, `removeOnComplete`, `data`, and `state`. It also validates the priority and state properties, doing a `console.warn()` if the values aren't correct, and resetting them to the defaults. If the job state is `pending`, then it will trigger workers when run.

#### `run()`
```javascript
job.run()
```

This method sets `job.state` to `pending`, and then calls `save()`. That's it.

#### `remove()`
```javascript
job.remove()
job = null
```

This method removes most of the job from Redis. Future releases will completely scrub Redis of any signs the job existed. After removing the job, you should set it to `null` to avoid stale job updates in case you accidentally call `save()` or `apply()` on it later. You can safely call this on the Job object passed into `processJob()` when you are done with it to remove it, although this is not necessary.

## Events

Currently job events are not supported, and for the Clock/ Worker(s) model it doesn't make much sense for the Clock to care what happens to a job after creating it. You are better off dropping failed jobs and posting the failed result to a MongoDB. If you REALLY want to re-fire a failed job, you can just do the following in `processJob()`

```javascript
queue.processJob('my job', (job, done) => {
    try {
        // Some code that fails
    } catch (e) {
        // Recreate job
        queue.createJob('my job', job.data).run()
        done()
    }
})
```

## Properties

`job.id = 0`  
`job.type = 'job'`  
`job.data = {}`  
`job.priority = priorities.normal || 3`  
`job.state = states[1] || 'pending'`  
`job.created = +new Date()`  
`job.timeout = 1000 // 1 second`

These are the currently supported properties, although more exist. Other properties are either not very useful, don't affect the job at all, or may crash the package.

It should be noted that you can, when creating a job, simply pass an object containing these properties and it will be coerced into a valid Job. Please know that changing the `id` is NOT recommended for ANY reason. It can cause serious problems, and really there is no reason to change it anyway. Problems include: job not updating correctly, duplicating the job, job never running, and overwriting other jobs just to name a few.

# Bugs

Since this package is based off Kue, I probably haven't worked all the kinks out of it yet. Everything documented here works exactly like it should, however there are some "features" that are still left over that haven't been 100% tested yet.

A big one is retrying failed jobs, which currently trying to do so by increasing `maxAttempts` will ultimately result in the worker crashing when trying to redo the job. The simplest solution for multiple attempts is to do the following.

```javascript
queue.processJob('my job', (job, done) => {
    try {
        // Some work that fails
    } catch (e) {
        if (!job.data.attempts) {
            job.data.attempts = 1
            setTimeout(queue.createJob, 'my job', job.data)
        } else if (job.data.attempts < 5) {
            job.data.attempts++
            setTimeout(queue.createJob, 'my job', job.data)
        } else {
            console.error('Job failed 5 times')
        }
        done()
    }
})
```

If the job fails 5 times, the error with be printed to the console and no more attempts will occur.

**If you find bugs in methods, when being used according to this documentation, please create an issue.**
