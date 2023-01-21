"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const winston = require("winston");
const cron = require("cron");
const db = require("../database");
const meta = require("../meta");
// The next line calls a function in a module that has not been updated to TS yet
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
const cronJob = cron.CronJob;
const jobs = {};
module.exports = function (User) {
    function startDigestJob(name, cronString, term) {
        jobs[name] = new cronJob(cronString, (() => __awaiter(this, void 0, void 0, function* () {
            winston.verbose(`[user/jobs] Digest job (${name}) started.`);
            try {
                if (name === 'digest.weekly') {
                    // The next line calls a function in a module that has not been updated to TS yet
                    // Disable max length because next disable comment is too long
                    // eslint-disable-next-line max-len
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                    const counter = yield db.increment('biweeklydigestcounter');
                    if (counter % 2) {
                        yield User.digest.execute({ interval: 'biweek' });
                    }
                }
                yield User.digest.execute({ interval: term });
            }
            catch (err) {
                winston.error(err.stack);
            }
        })), null, true);
        winston.verbose(`[user/jobs] Starting job (${name})`);
    }
    User.startJobs = function () {
        winston.verbose('[user/jobs] (Re-)starting jobs...');
        let { digestHour } = meta.config;
        // Fix digest hour if invalid
        if (isNaN(digestHour)) {
            digestHour = 17;
        }
        else if (digestHour > 23 || digestHour < 0) {
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
