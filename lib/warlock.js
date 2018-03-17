/* Packaged to remove dependency, also slightly modified.
 * Original can be found here: https://github.com/thedeveloper/warlock
 *                    or here: https://www.npmjs.com/package/node-redis-warlock
 *
 * Again, *slightly* modified ;)
 */
 
module.exports = function(redis) {
    
    var warlock = {}
    
    var lock = function(key, ttl, cb) {
        redis.set(key + ':lock', 'locked!', 'PX', ttl, 'NX', (error, lockSet) => {
            if (error) return cb(error, false)
            var unlock = warlock.unlock.bind(warlock, key, cb)
            if (!lockSet) unlock = false
            
            return cb(error, unlock)
        })
    }
    
    
    // Signature (key, [ttl,] cb[, attempts[, timeout]])
    // key & cb are REQUIRED, others are optional, but must be in the proper location!
    warlock.lock = function(key, ttl, cb, attempts, timeout) {
        if (typeof cb !== 'function') {
            if (typeof ttl === 'function') {
                cb = ttl
                ttl = 2000
            } else {
                throw new Error('Grrh! Warlock missing callback!')
            }
        }
        if (typeof key !== 'string') {
            return cb(new Error('Grrh! Warlock can\'t lock without the key!'))
        }
        if (typeof ttl !== 'number') {
            return cb(new Error('Grrh! Warlock doesn\'t know how long to lock!'))
        }
        
        if (!attempts || typeof attempts !== 'number') attempts = 1
        if (!timeout || typeof timeout !== 'number') timeout = 1000
        
        timeout = timeout.toFixed(0) // Force integer ms
        
        var tryLock = function() {
            attempts--
            lock(key, ttl, (error, unlock) => {
                if (!unlock) {
                    if (attempts <= 0) {
                        return cb(new Error('unable to obtain lock'), false)
                    }
                    return setTimeout(tryLock, timeout)
                }
                return cb(error, unlock)
            })
        }
        
        tryLock()
    }
    
    warlock.unlock = function(key, cb) {
        if (typeof cb !== 'function') throw new Error('Grrh! Warlock missing callback!')
        if (typeof key !== 'string') {
            return cb(new Error('Grrh! Warlock can\'t unlock without the key!'))
        }
        redis.get(key, (error, result) => {
            if (error) return cb(error)
            if (result === 'locked!') {
                redis.del(key, (error, result) => {
                    if (error) return cb(error, false)
                })
            }
        })
    }
    
    return warlock
    
}
