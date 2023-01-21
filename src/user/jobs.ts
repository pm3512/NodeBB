import winston = require('winston');
import cron = require('cron');
import db = require('../database');
import meta = require('../meta');

interface CronJob {
    stop: () => void
}

interface CronJobConstruct {
    new (
        cronTime?: string,
        onTick?: () => Promise<void>,
        onComplete?: () => Promise<void>,
        startNow?: boolean
    ): CronJob
}

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
    clean: () => Promise<void>
}

interface Jobs {
    [key: string]: CronJob
}

const cronJob = cron.CronJob as CronJobConstruct;

const jobs: Jobs = {};

module.exports = function (User: JobUser) {
    function startDigestJob(name: string, cronString: string, term: string) {
        jobs[name] = new cronJob(cronString, (async () => {
            winston.verbose(`[user/jobs] Digest job (${name}) started.`);
            try {
                if (name === 'digest.weekly') {
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
