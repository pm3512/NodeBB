import winston = require('winston');
import cron = require('cron');
import db = require('../database');
import meta = require('../meta');

interface Digest {
    execute: (arg0: {
        interval?: string
        subscribers?: Array<number>
    }) => Promise<void>
}

interface JobUser {
    startJobs: () => void,
    stopJobs: () => void,
    digest: Digest,
    reset: Reset
}

interface Reset {
    clean: () => void
}

interface Jobs {
    [key: string]: cron.CronJob
}

const cronJob = cron.CronJob;

const jobs: Jobs = {};

module.exports = function (User: JobUser) {
    function startDigestJob(name: string, cronString: string, term: string) {
        // The linter rule disabled here is not related to untyped imports, but I don't think there is a way around it.
        // cronJob constructor expects () => void as the second argument, but the JS code provides an async
        // () => Promise<void> function. Afaik, there is no way to convert one to another that would pass the linter.
        // no-floating-promises rule says that a promise needs to be awaited (impossible in non-async function), chained
        // with .then or .catch (doesn't get rid of the promise), or ignored with the void operator (which is
        // disallowed by another rule, no-void). Since there's no way to avoid a linter error, I'm disabling the rule
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        jobs[name] = new cronJob(cronString, (async () => {
            winston.verbose(`[user/jobs] Digest job (${name}) started.`);
            try {
                if (name === 'digest.weekly') {
                    // The next line calls a function in a module that has not been updated to TS yet
                    // Disable max length because next disable comment is too long
                    // eslint-disable-next-line max-len
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                    const counter = await db.increment('biweeklydigestcounter') as number;
                    if (counter % 2) {
                        await User.digest.execute({ interval: 'biweek' });
                    }
                }
                await User.digest.execute({ interval: term });
            } catch (err) {
                winston.error((err as Error).stack);
            }
        }), null, true);
        winston.verbose(`[user/jobs] Starting job (${name})`);
    }

    User.startJobs = function () {
        winston.verbose('[user/jobs] (Re-)starting jobs...');

        let { digestHour } = meta.config as { digestHour: number };

        // Fix digest hour if invalid
        if (isNaN(digestHour)) {
            digestHour = 17;
        } else if (digestHour > 23 || digestHour < 0) {
            digestHour = 0;
        }

        User.stopJobs();

        startDigestJob('digest.daily', `0 ${digestHour} * * *`, 'day');
        startDigestJob('digest.weekly', `0 ${digestHour} * * 0`, 'week');
        startDigestJob('digest.monthly', `0 ${digestHour} 1 * *`, 'month');

        jobs['reset.clean'] = new cronJob('0 0 * * *', User.reset.clean, null, true);
        winston.verbose('[user/jobs] Starting job (reset.clean)');

        winston.verbose(`[user/jobs] jobs started`);
    };

    User.stopJobs = function () {
        let terminated = 0;
        // Terminate any active cron jobs
        for (const jobId of Object.keys(jobs)) {
            winston.verbose(`[user/jobs] Terminating job (${jobId})`);
            jobs[jobId].stop();
            delete jobs[jobId];
            terminated += 1;
        }
        if (terminated > 0) {
            winston.verbose(`[user/jobs] ${terminated} jobs terminated`);
        }
    };
};
