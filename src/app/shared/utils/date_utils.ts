import {
  isValid, getISODay, addDays, addWeeks, addYears, addMonths,
  subDays, subWeeks, subYears,
  isSameDay, getYear,
  startOfDay, startOfMonth, startOfYear, startOfISOWeek,
  endOfDay, endOfMonth, endOfYear,
  parse, format as fnsFormat, parseISO,
} from 'date-fns';

type DateInput = Date | string | number;

function toDate(input: DateInput): Date {
  if (input instanceof Date) return input;
  if (typeof input === 'number') return new Date(input);
  // ISO string or other string formats
  const d = new Date(input as string);
  return isValid(d) ? d : new Date(NaN);
}

// Convert moment-style format tokens to date-fns tokens.
// Differences: YYYY→yyyy, DD→dd (MM, MMM, MMMM, HH, mm, ss are identical).
function toFnsFormat(fmt: string): string {
  return fmt
    .replace(/YYYY/g, 'yyyy')
    .replace(/YY/g, 'yy')
    .replace(/DD/g, 'dd')
    .replace(/\bD\b/g, 'd');
}

export class DateUtils {

    public static options: any = {
        cache: {},
        countries: ['england'],
        // date-fns format tokens (yyyy = 4-digit year, dd = 2-digit day)
        formats: [
            'yyyy-MM-dd', 'yyyy/MM/dd', 'yyyy.MM.dd', 'yyyy MM dd',
            'dd-MM-yyyy', 'dd/MM/yyyy', 'dd.MM.yyyy', 'dd MM yyyy',
            'dd MMM yyyy', 'dd MMMM yyyy', 'MMM yyyy', 'MMMM yyyy',
            'yyyyMMdd', 'ddMMyyyy'
        ]
    };

    static easterSunday(year: number): Date {
        const f = Math.floor,
            G = year % 19,
            C = f(year / 100),
            H = (C - f(C / 4) - f((8 * C + 13) / 25) + 19 * G + 15) % 30,
            I = H - f(H / 28) * (1 - f(29 / (H + 1)) * f((21 - G) / 11)),
            J = (year + f(year / 4) + I + 2 - C + f(C / 4)) % 7,
            L = I - J,
            month = 3 + f((L + 40) / 44),
            day = L + 28 - 31 * f(month / 4);
        return new Date(Date.UTC(year, (month - 1), day));
    }

    static isWeekDay(date: DateInput): boolean {
        return getISODay(toDate(date)) < 6;
    }

    static isBusinessDay(date: DateInput, ...countries): boolean {
        return DateUtils.isWeekDay(date) && !DateUtils.isBankHoliday(date, ...countries);
    }

    static isBankHoliday(date: DateInput, ...countries): boolean {
        const dt = toDate(date);
        const holidays = DateUtils.bankHolidays(getYear(dt), ...countries);
        for (const key in holidays) {
            if (isSameDay(dt, toDate(holidays[key]))) {
                return true;
            }
        }
        return false;
    }

    static skipWeekends(date: DateInput, inc: number): Date {
        let dt = addDays(toDate(date), inc);
        if (Math.abs(inc) > 0) {
            while (!DateUtils.isWeekDay(dt)) {
                dt = addDays(dt, inc);
            }
        }
        return dt;
    }

    static nextDay(date: DateInput, isoWeekday: number): Date {
        const dt = toDate(date);
        if (getISODay(dt) <= isoWeekday) {
            return addDays(startOfISOWeek(dt), isoWeekday - 1);
        } else {
            return addDays(startOfISOWeek(addWeeks(dt, 1)), isoWeekday - 1);
        }
    }

    static previousDay(date: DateInput, isoWeekday: number): Date {
        const dt = toDate(date);
        if (getISODay(dt) >= isoWeekday) {
            return addDays(startOfISOWeek(dt), isoWeekday - 1);
        } else {
            return addDays(startOfISOWeek(subWeeks(dt, 1)), isoWeekday - 1);
        }
    }

    static nextWeekDay(date: DateInput): Date {
        let dt = toDate(date);
        if (!DateUtils.isWeekDay(dt)) {
            dt = DateUtils.skipWeekends(dt, 1);
        }
        return dt;
    }

    static previousWeekDay(date: DateInput): Date {
        let dt = toDate(date);
        if (!DateUtils.isWeekDay(dt)) {
            dt = DateUtils.skipWeekends(dt, -1);
        }
        return dt;
    }

    static nextBusinessDay(date: DateInput): Date {
        let dt = DateUtils.nextWeekDay(date);
        while (DateUtils.isBankHoliday(dt)) {
            dt = DateUtils.nextWeekDay(addDays(dt, 1));
        }
        return dt;
    }

    static previousBusinessDay(date: DateInput): Date {
        let dt = DateUtils.previousWeekDay(date);
        while (DateUtils.isBankHoliday(dt)) {
            dt = DateUtils.previousWeekDay(subDays(dt, 1));
        }
        return dt;
    }

    static bankHolidays(year: number, ...countries) {
        if (!countries || !countries.length) {
            countries = DateUtils.options.countries.slice();
        }

        countries = countries.sort().map(c => c.trim().toLowerCase());
        const key = `${year}_${countries.join('_')}`;
        if (DateUtils.options.cache[key]) { return DateUtils.options.cache[key]; }

        const holidays: Record<string, Date> = {};
        const easterSunday = DateUtils.easterSunday(year);
        holidays['New Year'] = DateUtils.nextWeekDay(new Date(year, 0, 1));
        holidays['Good Friday'] = subDays(easterSunday, 2);
        holidays['Easter Monday'] = addDays(easterSunday, 1);
        holidays['Early May bank holiday'] = DateUtils.nextDay(new Date(year, 4, 1), 1);
        holidays['Spring bank holiday'] = DateUtils.previousDay(new Date(year, 4, 31), 1);

        if (countries.indexOf('northern_ireland') > -1) {
            holidays['St Patrick\'s Day'] = DateUtils.nextWeekDay(new Date(year, 2, 17));
        }

        if (countries.indexOf('scotland') > -1) {
            holidays['Summer bank holiday'] = DateUtils.previousDay(new Date(year, 7, 1), 1);
            holidays['St Andrew\'s Day'] = DateUtils.nextWeekDay(new Date(year, 10, 30));
        } else {
            holidays['Summer bank holiday'] = DateUtils.previousDay(new Date(year, 7, 31), 1);
        }

        const christmas = new Date(year, 11, 25);
        const christmasIsoDay = getISODay(christmas);
        if (christmasIsoDay === 6) {
            holidays['Christmas Day (substitute day)'] = addDays(christmas, 3);
            holidays['Boxing Day (substitute day)'] = addDays(christmas, 2);
        } else if (christmasIsoDay === 7) {
            holidays['Christmas Day (substitute day)'] = addDays(christmas, 2);
            holidays['Boxing Day'] = addDays(christmas, 1);
        } else {
            holidays['Christmas Day'] = christmas;
            holidays['Boxing Day'] = DateUtils.nextWeekDay(addDays(christmas, 1));
        }

        DateUtils.options.cache[key] = holidays;
        return holidays;
    }

    static math(expr: string, options: any = {}): Date | string {
        const defaultOptions = {
            now: new Date(),
            formats: DateUtils.options.formats
        };

        const now = toDate(options.now || defaultOptions.now);
        options = { ...defaultOptions, ...options };

        const [, dateFormat] = expr.match(/\|\|?\s*(.*)\s*$/) || [null, null];
        let date: Date = null;
        let tokens = expr.replace(/\|\|?\s*(.*)\s*$/, '').split(/([\+-]\s*[0-9]+\s*[yMwdhHms])|(\/\^?[yMwdhHmsb<>]+)/).filter(t => t && t.trim());
        expr = tokens.shift();

        switch (expr.trim().toLowerCase()) {
            case 'now':
                date = new Date();
                break;

            case 'today':
            case '$today':
            case 'date':
            case '$date':
                date = startOfDay(new Date());
                break;

            case 'tomorrow':
                date = addDays(new Date(), 1);
                break;

            case 'yesterday':
                date = subDays(new Date(), 1);
                break;
            default:
                if (options.formats.length) {
                    for (const fmt of options.formats) {
                        const candidate = expr.substring(0, fmt.length);
                        try {
                            const parsed = parse(candidate, fmt, now);
                            if (isValid(parsed) && fnsFormat(parsed, fmt) === candidate) {
                                date = parsed;
                                break;
                            }
                        } catch { /* ignore */ }
                    }
                }

                if (!date) {
                    const d = new Date(expr);
                    if (isValid(d)) {
                        date = d;
                    }
                }
                break;
        }

        if (!date) {
            return null;
        }

        const types: Record<string, string> = {
            y: 'year', M: 'month', w: 'week', d: 'day', h: 'hour', H: 'hour', 'm': 'month', s: 'second'
        };

        tokens = tokens.map(t => t.replace(/\s*/g, ''));
        tokens.forEach(token => {
            if (token.match(/\/(\^?[yMwdhHmsb<>])/)) {
                token.split(/\/(\^?[yMwdhHmsb<>])/).filter(t => t && t.trim()).forEach(modifier => {
                    switch (modifier) {
                        case 'b':
                            date = DateUtils.nextWeekDay(startOfMonth(date));
                            break;

                        case '^b':
                            date = DateUtils.previousWeekDay(endOfMonth(date));
                            break;

                        case '>':
                            date = DateUtils.nextBusinessDay(date);
                            break;

                        case '<':
                            date = DateUtils.previousBusinessDay(date);
                            break;

                        default: {
                            const mod = modifier.replace('^', '');
                            if (!types[mod]) {
                                throw new Error(`Unknown date modifier ${mod}`);
                            }

                            const unit = types[mod];
                            if (modifier.startsWith('^')) {
                                // endOf
                                date = unit === 'day' ? endOfDay(date)
                                     : unit === 'month' ? endOfMonth(date)
                                     : unit === 'year' ? endOfYear(date)
                                     : unit === 'week' ? endOfISOWeek(date)
                                     : date;
                            } else {
                                // startOf
                                date = unit === 'day' ? startOfDay(date)
                                     : unit === 'month' ? startOfMonth(date)
                                     : unit === 'year' ? startOfYear(date)
                                     : unit === 'week' ? startOfISOWeek(date)
                                     : date;
                            }
                            break;
                        }
                    }
                });
            } else if (token.match(/^([+-])([0-9]+)([yMwdhHms])$/)) {
                const [, method, value, duration] = token.match(/^([+-])([0-9]+)([yMwdhHms])$/);
                const n = +value;
                const unit = types[duration];
                if (method === '+') {
                    date = unit === 'year' ? addYears(date, n)
                         : unit === 'month' ? addMonths(date, n)
                         : unit === 'week' ? addWeeks(date, n)
                         : addDays(date, n);
                } else {
                    date = unit === 'year' ? subYears(date, n)
                         : unit === 'month' ? subMonths(date, n)
                         : unit === 'week' ? subWeeks(date, n)
                         : subDays(date, n);
                }
            }
        });

        if (dateFormat) {
            return fnsFormat(date, dateFormat);
        }

        return date;
    }

    static dateIs(types: string[] | string, date: Date) {
        if (!types.length) {
            return true;
        }

        if (!isValid(date)) {
            return false;
        }

        let validity = 0;

        for (let i = 0; i < types.length; i++) {
            let count = 0;
            (types as string[])[i].split('|').forEach(type => {
                const value = !(type.replace(/^(!).*/, '$1') === '!');
                switch (type.replace(/^!(.*)/, '$1')) {
                    case 'weekday':
                        if ((DateUtils.isWeekDay(date) === value)) {
                            count++;
                        }
                        break;
                    case 'weekend':
                        if ((!DateUtils.isWeekDay(date)) === value) {
                            count++;
                        }
                        break;
                    case 'workingday':
                        if ((DateUtils.isBusinessDay(date)) === value) {
                            count++;
                        }
                        break;
                    case 'holiday':
                        if ((DateUtils.isBankHoliday(date)) === value) {
                            count++;
                        }
                        break;
                    case 'monthend': {
                        const ref = DateUtils.format(date, 'dd/MM/yyyy');
                        const check = [DateUtils.math(`${ref}/^b|dd/MM/yyyy`), DateUtils.math(`${ref}/^M|dd/MM/yyyy`), DateUtils.math(`${ref}/^b<|dd/MM/yyyy`)];
                        if ((check.indexOf(ref) !== -1) === value) {
                            count++;
                        }
                        break;
                    }
                    case 'monthstart': {
                        const ref = DateUtils.format(date, 'dd/MM/yyyy');
                        const check = [DateUtils.math(`${ref}/b|dd/MM/yyyy`), DateUtils.math(`${ref}/b<|dd/MM/yyyy`), DateUtils.math(`${ref}/M|dd/MM/yyyy`)];
                        if ((check.indexOf(ref) !== -1) === value) {
                            count++;
                        }
                        break;
                    }
                }
            });

            if (count > 0) {
                validity++;
            }
        }

        return validity == types.length;
    }

    static format(date: DateInput, fmt: string): string {
        return fnsFormat(toDate(date), fmt);
    }

}

// Re-export toFnsFormat for use in components migrating from moment format strings
export { toFnsFormat };

function endOfISOWeek(date: Date): Date {
  return addDays(startOfISOWeek(date), 6);
}

function subMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() - n);
  return d;
}
