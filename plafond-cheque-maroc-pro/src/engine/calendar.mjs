/**
 * PlafondChèque Maroc Pro — Unified Moroccan Banking Calendar & Timezone Engine (v11.0.0)
 *
 * - Timezone-safe Moroccan date resolution (`Africa/Casablanca`)
 * - Fixed Moroccan national holidays + dynamic Islamic holiday calculation (`islamic-umalqura` + astronomical fallback)
 * - Clear distinction between officially confirmed holidays (`estimated: false`) and estimated lunar dates (`estimated: true`)
 */

export const APP_VERSION = '12.5.1';
export const DB_SCHEMA_VERSION = 4;
export const BACKUP_FORMAT_VERSION = '11.0';

export const DEFAULT_MOROCCAN_HOLIDAYS = [
  {
    date: '2026-01-01',
    label: 'Nouvel An',
    labelAr: 'رأس السنة الميلادية',
    labelEn: 'New Year’s Day',
    type: 'national',
    estimated: false
  },
  {
    date: '2026-01-11',
    label: 'Manifeste de l’Indépendance',
    labelAr: 'تقديم وثيقة الاستقلال',
    labelEn: 'Proclamation of Independence',
    type: 'national',
    estimated: false
  },
  {
    date: '2026-01-14',
    label: 'Nouvel An Amazigh',
    labelAr: 'رأس السنة الأمازيغية',
    labelEn: 'Amazigh New Year',
    type: 'national',
    estimated: false
  },
  {
    date: '2026-03-20',
    label: 'Aïd Al-Fitr (1er Chaoual)',
    labelAr: 'عيد الفطر (اليوم الأول)',
    labelEn: 'Eid al-Fitr (Day 1)',
    type: 'religious',
    estimated: true
  },
  {
    date: '2026-03-21',
    label: 'Aïd Al-Fitr (2ème jour)',
    labelAr: 'عيد الفطر (اليوم الثاني)',
    labelEn: 'Eid al-Fitr (Day 2)',
    type: 'religious',
    estimated: true
  },
  {
    date: '2026-05-01',
    label: 'Fête du Travail',
    labelAr: 'عيد الشغل',
    labelEn: 'Labour Day',
    type: 'national',
    estimated: false
  },
  {
    date: '2026-05-27',
    label: 'Aïd Al-Adha (10 Dhou Al-Hijja)',
    labelAr: 'عيد الأضحى (اليوم الأول)',
    labelEn: 'Eid al-Adha (Day 1)',
    type: 'religious',
    estimated: true
  },
  {
    date: '2026-05-28',
    label: 'Aïd Al-Adha (2ème jour)',
    labelAr: 'عيد الأضحى (اليوم الثاني)',
    labelEn: 'Eid al-Adha (Day 2)',
    type: 'religious',
    estimated: true
  },
  {
    date: '2026-06-17',
    label: '1er Moharram (Nouvel An Hégirien)',
    labelAr: 'فاتح محرم (رأس السنة الهجرية)',
    labelEn: 'Islamic New Year (1st Muharram)',
    type: 'religious',
    estimated: true
  },
  {
    date: '2026-07-30',
    label: 'Fête du Trône',
    labelAr: 'عيد العرش',
    labelEn: 'Throne Day',
    type: 'national',
    estimated: false
  },
  {
    date: '2026-08-14',
    label: 'Allégeance Oued Ed-Dahab',
    labelAr: 'ذكرى استرجاع وادي الذهب',
    labelEn: 'Oued Ed-Dahab Day',
    type: 'national',
    estimated: false
  },
  {
    date: '2026-08-20',
    label: 'Révolution du Roi et du Peuple',
    labelAr: 'ثورة الملك والشعب',
    labelEn: 'Revolution of the King and the People',
    type: 'national',
    estimated: false
  },
  {
    date: '2026-08-21',
    label: 'Fête de la Jeunesse',
    labelAr: 'عيد الشباب',
    labelEn: 'Youth Day',
    type: 'national',
    estimated: false
  },
  {
    date: '2026-08-26',
    label: 'Aïd Al-Mawlid Annabawi',
    labelAr: 'ذكرى المولد النبوي الشريف',
    labelEn: 'Prophet’s Birthday (Mawlid)',
    type: 'religious',
    estimated: true
  },
  {
    date: '2026-08-27',
    label: 'Aïd Al-Mawlid (2ème jour)',
    labelAr: 'عيد المولد النبوي (اليوم الثاني)',
    labelEn: 'Mawlid (Day 2)',
    type: 'religious',
    estimated: true
  },
  {
    date: '2026-11-06',
    label: 'Marche Verte',
    labelAr: 'ذكرى المسيرة الخضراء',
    labelEn: 'Green March',
    type: 'national',
    estimated: false
  },
  {
    date: '2026-11-18',
    label: 'Fête de l’Indépendance',
    labelAr: 'عيد الاستقلال',
    labelEn: 'Independence Day',
    type: 'national',
    estimated: false
  },
  {
    date: '2027-01-01',
    label: 'Nouvel An 2027',
    labelAr: 'رأس السنة الميلادية 2027',
    labelEn: 'New Year’s Day 2027',
    type: 'national',
    estimated: false
  },
  {
    date: '2027-01-11',
    label: 'Manifeste de l’Indépendance 2027',
    labelAr: 'وثيقة الاستقلال 2027',
    labelEn: 'Proclamation of Independence 2027',
    type: 'national',
    estimated: false
  },
  {
    date: '2027-01-14',
    label: 'Nouvel An Amazigh 2027',
    labelAr: 'رأس السنة الأمازيغية 2027',
    labelEn: 'Amazigh New Year 2027',
    type: 'national',
    estimated: false
  },
  {
    date: '2027-03-09',
    label: 'Aïd Al-Fitr 2027',
    labelAr: 'عيد الفطر 2027',
    labelEn: 'Eid al-Fitr 2027 (Day 1)',
    type: 'religious',
    estimated: true
  },
  {
    date: '2027-03-10',
    label: 'Aïd Al-Fitr J2 2027',
    labelAr: 'عيد الفطر اليوم الثاني 2027',
    labelEn: 'Eid al-Fitr 2027 (Day 2)',
    type: 'religious',
    estimated: true
  },
  {
    date: '2027-05-01',
    label: 'Fête du Travail 2027',
    labelAr: 'عيد الشغل 2027',
    labelEn: 'Labour Day 2027',
    type: 'national',
    estimated: false
  },
  {
    date: '2027-05-16',
    label: 'Aïd Al-Adha 2027',
    labelAr: 'عيد الأضحى 2027',
    labelEn: 'Eid al-Adha 2027 (Day 1)',
    type: 'religious',
    estimated: true
  },
  {
    date: '2027-05-17',
    label: 'Aïd Al-Adha J2 2027',
    labelAr: 'عيد الأضحى اليوم الثاني 2027',
    labelEn: 'Eid al-Adha 2027 (Day 2)',
    type: 'religious',
    estimated: true
  },
  {
    date: '2027-06-06',
    label: '1er Moharram 2027',
    labelAr: 'فاتح محرم 2027',
    labelEn: 'Islamic New Year 2027',
    type: 'religious',
    estimated: true
  },
  {
    date: '2027-07-30',
    label: 'Fête du Trône 2027',
    labelAr: 'عيد العرش 2027',
    labelEn: 'Throne Day 2027',
    type: 'national',
    estimated: false
  },
  {
    date: '2027-08-14',
    label: 'Allégeance Oued Ed-Dahab 2027',
    labelAr: 'وادي الذهب 2027',
    labelEn: 'Oued Ed-Dahab Day 2027',
    type: 'national',
    estimated: false
  },
  {
    date: '2027-08-15',
    label: 'Aïd Al-Mawlid 2027',
    labelAr: 'عيد المولد النبوي 2027',
    labelEn: 'Mawlid 2027',
    type: 'religious',
    estimated: true
  },
  {
    date: '2027-08-20',
    label: 'Révolution du Roi et du Peuple 2027',
    labelAr: 'ثورة الملك والشعب 2027',
    labelEn: 'Revolution Day 2027',
    type: 'national',
    estimated: false
  },
  {
    date: '2027-08-21',
    label: 'Fête de la Jeunesse 2027',
    labelAr: 'عيد الشباب 2027',
    labelEn: 'Youth Day 2027',
    type: 'national',
    estimated: false
  },
  {
    date: '2027-11-06',
    label: 'Marche Verte 2027',
    labelAr: 'المسيرة الخضراء 2027',
    labelEn: 'Green March 2027',
    type: 'national',
    estimated: false
  },
  {
    date: '2027-11-18',
    label: 'Fête de l’Indépendance 2027',
    labelAr: 'عيد الاستقلال 2027',
    labelEn: 'Independence Day 2027',
    type: 'national',
    estimated: false
  }
];

export function formatYMD(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns today's YYYY-MM-DD in Moroccan time (`Africa/Casablanca`), avoiding UTC midnight drift
 * and eliminating any hardcoded fallback date.
 */
export function getMoroccanTodayYMD(referenceDateObj = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Casablanca',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(referenceDateObj);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch (e) {}
  return formatYMD(referenceDateObj);
}

export function isValidYMD(ymdStr) {
  if (typeof ymdStr !== 'string') return false;
  const m = ymdStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(year, month - 1, day, 12, 0, 0);
  return dt.getFullYear() === year && dt.getMonth() + 1 === month && dt.getDate() === day;
}

export function parseYMD(ymdStr) {
  if (isValidYMD(ymdStr)) {
    const [y, m, d] = ymdStr.trim().split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }
  const todayStr = getMoroccanTodayYMD();
  const [ty, tm, td] = todayStr.split('-').map(Number);
  return new Date(ty, tm - 1, td, 12, 0, 0);
}

export function formatNumericDMY(ymdStr) {
  const d = parseYMD(ymdStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function addCalendarDays(ymdStr, days) {
  const d = parseYMD(ymdStr);
  d.setDate(d.getDate() + Number(days || 0));
  return formatYMD(d);
}

/**
 * Generates Moroccan National + Estimated Religious Holidays for any Gregorian year (e.g. 2026–2035+).
 * Uses Intl Islamic Umm al-Qura calendar calculation (with astronomical fallback) and marks all
 * religious holidays as `estimated: true` (±1 day subject to Habous moon sighting).
 */
export function generateMoroccanHolidaysForYear(year) {
  const y = parseInt(year, 10) || new Date().getFullYear();
  if (y === 2026 || y === 2027) {
    return DEFAULT_MOROCCAN_HOLIDAYS.filter((h) => h.date.startsWith(`${y}-`)).map((h) => ({ ...h }));
  }

  const fixedNational = [
    {
      date: `${y}-01-01`,
      label: `Nouvel An (${y})`,
      labelAr: 'رأس السنة الميلادية',
      labelEn: 'New Year’s Day',
      type: 'national',
      estimated: false
    },
    {
      date: `${y}-01-11`,
      label: `Manifeste de l’Indépendance (${y})`,
      labelAr: 'تقديم وثيقة الاستقلال',
      labelEn: 'Proclamation of Independence',
      type: 'national',
      estimated: false
    },
    {
      date: `${y}-01-14`,
      label: `Nouvel An Amazigh (${y})`,
      labelAr: 'رأس السنة الأمازيغية',
      labelEn: 'Amazigh New Year',
      type: 'national',
      estimated: false
    },
    {
      date: `${y}-05-01`,
      label: `Fête du Travail (${y})`,
      labelAr: 'عيد الشغل',
      labelEn: 'Labour Day',
      type: 'national',
      estimated: false
    },
    {
      date: `${y}-07-30`,
      label: `Fête du Trône (${y})`,
      labelAr: 'عيد العرش',
      labelEn: 'Throne Day',
      type: 'national',
      estimated: false
    },
    {
      date: `${y}-08-14`,
      label: `Allégeance Oued Ed-Dahab (${y})`,
      labelAr: 'ذكرى استرجاع وادي الذهب',
      labelEn: 'Oued Ed-Dahab Day',
      type: 'national',
      estimated: false
    },
    {
      date: `${y}-08-20`,
      label: `Révolution du Roi et du Peuple (${y})`,
      labelAr: 'ثورة الملك والشعب',
      labelEn: 'Revolution of the King and the People',
      type: 'national',
      estimated: false
    },
    {
      date: `${y}-08-21`,
      label: `Fête de la Jeunesse (${y})`,
      labelAr: 'عيد الشباب',
      labelEn: 'Youth Day',
      type: 'national',
      estimated: false
    },
    {
      date: `${y}-11-06`,
      label: `Marche Verte (${y})`,
      labelAr: 'ذكرى المسيرة الخضراء',
      labelEn: 'Green March',
      type: 'national',
      estimated: false
    },
    {
      date: `${y}-11-18`,
      label: `Fête de l’Indépendance (${y})`,
      labelAr: 'عيد الاستقلال',
      labelEn: 'Independence Day',
      type: 'national',
      estimated: false
    }
  ];

  const religiousForYear = [];
  let intlSuccess = false;
  try {
    const islamicFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
      timeZone: 'Africa/Casablanca',
      month: 'numeric',
      day: 'numeric'
    });
    const cursor = new Date(y, 0, 1, 12, 0, 0);
    while (cursor.getFullYear() === y) {
      const parts = islamicFmt.formatToParts(cursor);
      const hMonth = parseInt(parts.find((p) => p.type === 'month')?.value || '0', 10);
      const hDay = parseInt(parts.find((p) => p.type === 'day')?.value || '0', 10);
      const ymd = formatYMD(cursor);
      if (hMonth === 1 && hDay === 1) {
        religiousForYear.push({
          date: ymd,
          label: `1er Moharram — Estimé ±1j (${y})`,
          labelAr: 'فاتح محرم (تقديري ±1 يوم)',
          labelEn: 'Islamic New Year (Est. ±1d)',
          type: 'religious',
          estimated: true
        });
      } else if (hMonth === 3 && hDay === 12) {
        religiousForYear.push({
          date: ymd,
          label: `Aïd Al-Mawlid J1 — Estimé ±1j (${y})`,
          labelAr: 'ذكرى المولد النبوي (تقديري ±1 يوم)',
          labelEn: 'Prophet’s Birthday Day 1 (Est. ±1d)',
          type: 'religious',
          estimated: true
        });
      } else if (hMonth === 3 && hDay === 13) {
        religiousForYear.push({
          date: ymd,
          label: `Aïd Al-Mawlid J2 — Estimé ±1j (${y})`,
          labelAr: 'عيد المولد النبوي اليوم 2 (تقديري)',
          labelEn: 'Prophet’s Birthday Day 2 (Est. ±1d)',
          type: 'religious',
          estimated: true
        });
      } else if (hMonth === 10 && hDay === 1) {
        religiousForYear.push({
          date: ymd,
          label: `Aïd Al-Fitr J1 — Estimé ±1j (${y})`,
          labelAr: 'عيد الفطر اليوم 1 (تقديري ±1 يوم)',
          labelEn: 'Eid al-Fitr Day 1 (Est. ±1d)',
          type: 'religious',
          estimated: true
        });
      } else if (hMonth === 10 && hDay === 2) {
        religiousForYear.push({
          date: ymd,
          label: `Aïd Al-Fitr J2 — Estimé ±1j (${y})`,
          labelAr: 'عيد الفطر اليوم 2 (تقديري ±1 يوم)',
          labelEn: 'Eid al-Fitr Day 2 (Est. ±1d)',
          type: 'religious',
          estimated: true
        });
      } else if (hMonth === 12 && hDay === 10) {
        religiousForYear.push({
          date: ymd,
          label: `Aïd Al-Adha J1 — Estimé ±1j (${y})`,
          labelAr: 'عيد الأضحى اليوم 1 (تقديري ±1 يوم)',
          labelEn: 'Eid al-Adha Day 1 (Est. ±1d)',
          type: 'religious',
          estimated: true
        });
      } else if (hMonth === 12 && hDay === 11) {
        religiousForYear.push({
          date: ymd,
          label: `Aïd Al-Adha J2 — Estimé ±1j (${y})`,
          labelAr: 'عيد الأضحى اليوم 2 (تقديري ±1 يوم)',
          labelEn: 'Eid al-Adha Day 2 (Est. ±1d)',
          type: 'religious',
          estimated: true
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    if (religiousForYear.length >= 4) intlSuccess = true;
  } catch (e) {}

  if (!intlSuccess) {
    // Tabular Islamic Calendar Algorithm (30-year 10,631-day lunar cycle via Julian Day Number conversion)
    // Used when Intl islamic-umalqura is unavailable; all dates remain strictly marked estimated: true (±1j Habous).
    function gregorianToHijriTabular(gYear, gMonth, gDay) {
      const a = Math.floor((14 - gMonth) / 12);
      const y1 = gYear + 4800 - a;
      const m1 = gMonth + 12 * a - 3;
      const jdn =
        gDay +
        Math.floor((153 * m1 + 2) / 5) +
        365 * y1 +
        Math.floor(y1 / 4) -
        Math.floor(y1 / 100) +
        Math.floor(y1 / 400) -
        32045;
      const l = jdn - 1948440 + 10632;
      const n = Math.floor((l - 1) / 10631);
      const l2 = l - 10631 * n + 354;
      const j =
        Math.floor((10985 - l2) / 5316) * Math.floor((50 * l2) / 17719) +
        Math.floor(l2 / 5670) * Math.floor((43 * l2) / 15238);
      const l3 =
        l2 -
        Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) -
        Math.floor(j / 16) * Math.floor((15238 * j) / 43) +
        29;
      const hMonth = Math.floor((24 * l3) / 709);
      const hDay = l3 - Math.floor((709 * hMonth) / 24);
      const hYear = 30 * n + j - 30;
      return { hYear, hMonth, hDay };
    }
    const cursor = new Date(y, 0, 1, 12, 0, 0);
    while (cursor.getFullYear() === y) {
      const { hMonth, hDay } = gregorianToHijriTabular(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
      const ymd = formatYMD(cursor);
      if (hMonth === 1 && hDay === 1) {
        religiousForYear.push({
          date: ymd,
          label: `1er Moharram — Estimé ±1j (${y})`,
          labelAr: 'فاتح محرم (تقديري ±1 يوم)',
          labelEn: 'Islamic New Year (Est. ±1d)',
          type: 'religious',
          estimated: true
        });
      } else if (hMonth === 3 && hDay === 12) {
        religiousForYear.push({
          date: ymd,
          label: `Aïd Al-Mawlid J1 — Estimé ±1j (${y})`,
          labelAr: 'ذكرى المولد النبوي (تقديري ±1 يوم)',
          labelEn: 'Prophet’s Birthday Day 1 (Est. ±1d)',
          type: 'religious',
          estimated: true
        });
      } else if (hMonth === 3 && hDay === 13) {
        religiousForYear.push({
          date: ymd,
          label: `Aïd Al-Mawlid J2 — Estimé ±1j (${y})`,
          labelAr: 'عيد المولد النبوي اليوم 2 (تقديري)',
          labelEn: 'Prophet’s Birthday Day 2 (Est. ±1d)',
          type: 'religious',
          estimated: true
        });
      } else if (hMonth === 10 && hDay === 1) {
        religiousForYear.push({
          date: ymd,
          label: `Aïd Al-Fitr J1 — Estimé ±1j (${y})`,
          labelAr: 'عيد الفطر اليوم 1 (تقديري ±1 يوم)',
          labelEn: 'Eid al-Fitr Day 1 (Est. ±1d)',
          type: 'religious',
          estimated: true
        });
      } else if (hMonth === 10 && hDay === 2) {
        religiousForYear.push({
          date: ymd,
          label: `Aïd Al-Fitr J2 — Estimé ±1j (${y})`,
          labelAr: 'عيد الفطر اليوم 2 (تقديري ±1 يوم)',
          labelEn: 'Eid al-Fitr Day 2 (Est. ±1d)',
          type: 'religious',
          estimated: true
        });
      } else if (hMonth === 12 && hDay === 10) {
        religiousForYear.push({
          date: ymd,
          label: `Aïd Al-Adha J1 — Estimé ±1j (${y})`,
          labelAr: 'عيد الأضحى اليوم 1 (تقديري ±1 يوم)',
          labelEn: 'Eid al-Adha Day 1 (Est. ±1d)',
          type: 'religious',
          estimated: true
        });
      } else if (hMonth === 12 && hDay === 11) {
        religiousForYear.push({
          date: ymd,
          label: `Aïd Al-Adha J2 — Estimé ±1j (${y})`,
          labelAr: 'عيد الأضحى اليوم 2 (تقديري ±1 يوم)',
          labelEn: 'Eid al-Adha Day 2 (Est. ±1d)',
          type: 'religious',
          estimated: true
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return [...fixedNational, ...religiousForYear].sort((a, b) => a.date.localeCompare(b.date));
}

export function getHolidayForDate(ymdStr, holidays = DEFAULT_MOROCCAN_HOLIDAYS) {
  return (holidays || []).find((h) => h.date === ymdStr) || null;
}

export function getNonWorkingDayReason(ymdStr, holidays = DEFAULT_MOROCCAN_HOLIDAYS) {
  const d = parseYMD(ymdStr);
  const dow = d.getDay();
  if (dow === 6) return { isWorking: false, code: 'SATURDAY', reason: 'Samedi (Week-end)' };
  if (dow === 0) return { isWorking: false, code: 'SUNDAY', reason: 'Dimanche (Week-end)' };
  const hol = getHolidayForDate(ymdStr, holidays);
  if (hol) {
    const estSuffix = hol.estimated ? ' [Date religieuse estimée ±1j]' : '';
    return { isWorking: false, code: 'HOLIDAY', reason: `Jour férié : ${hol.label}${estSuffix}`, holiday: hol };
  }
  return { isWorking: true, code: 'WORKING_DAY', reason: null };
}

export function isBusinessDay(ymdStr, holidays = DEFAULT_MOROCCAN_HOLIDAYS) {
  return getNonWorkingDayReason(ymdStr, holidays).isWorking;
}

export function getAnticipatedBusinessDay(targetYMD, minAllowedYMD, holidays = DEFAULT_MOROCCAN_HOLIDAYS) {
  let current = targetYMD;
  const skippedDays = [];
  let safety = 0;
  while (!isBusinessDay(current, holidays) && safety < 90) {
    const info = getNonWorkingDayReason(current, holidays);
    skippedDays.push({ date: current, reason: info.reason });
    current = addCalendarDays(current, -1);
    safety++;
  }
  if (minAllowedYMD && current < minAllowedYMD) {
    let forward = minAllowedYMD;
    let fSafety = 0;
    while (!isBusinessDay(forward, holidays) && fSafety < 90) {
      forward = addCalendarDays(forward, 1);
      fSafety++;
    }
    return { dateOuvrable: forward, skippedDays, clampedToMinDate: true };
  }
  return { dateOuvrable: current, skippedDays, clampedToMinDate: false };
}

export function validateHolidaysJsonSchema(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      valid: false,
      reason: 'Root JSON must be an object',
      holidays: DEFAULT_MOROCCAN_HOLIDAYS.map((h) => ({ ...h }))
    };
  }
  if (Number(raw.schemaVersion) !== 1 || typeof raw.version !== 'string' || !raw.version.trim()) {
    return {
      valid: false,
      reason: 'Invalid or unsupported schemaVersion/version',
      holidays: DEFAULT_MOROCCAN_HOLIDAYS.map((h) => ({ ...h }))
    };
  }
  if (!Array.isArray(raw.holidays) || raw.holidays.length === 0) {
    return {
      valid: false,
      reason: 'holidays array missing or empty',
      holidays: DEFAULT_MOROCCAN_HOLIDAYS.map((h) => ({ ...h }))
    };
  }
  const normalized = [];
  for (let i = 0; i < raw.holidays.length; i++) {
    const h = raw.holidays[i];
    if (!h || typeof h !== 'object' || !isValidYMD(h.date) || typeof h.label !== 'string' || !h.label.trim()) {
      return {
        valid: false,
        reason: `Invalid holiday entry at index ${i}`,
        holidays: DEFAULT_MOROCCAN_HOLIDAYS.map((x) => ({ ...x }))
      };
    }
    const type = h.type === 'religious' ? 'religious' : h.type === 'national' ? 'national' : null;
    if (!type || typeof h.estimated !== 'boolean') {
      return {
        valid: false,
        reason: `Invalid type/estimated flag at index ${i}`,
        holidays: DEFAULT_MOROCCAN_HOLIDAYS.map((x) => ({ ...x }))
      };
    }
    normalized.push({
      date: h.date.trim(),
      label: h.label.trim(),
      labelAr: typeof h.labelAr === 'string' ? h.labelAr.trim() : h.label.trim(),
      labelEn: typeof h.labelEn === 'string' ? h.labelEn.trim() : h.label.trim(),
      type,
      estimated: h.estimated
    });
  }
  return { valid: true, version: raw.version.trim(), holidays: normalized };
}

export async function loadVersionedHolidaysJson(url = './data/moroccan-holidays.json', fetchImpl = globalThis.fetch) {
  try {
    if (typeof fetchImpl !== 'function')
      return { valid: false, fallback: true, holidays: DEFAULT_MOROCCAN_HOLIDAYS.map((h) => ({ ...h })) };
    const resp = await fetchImpl(url, { cache: 'no-cache' });
    if (!resp || !resp.ok)
      return { valid: false, fallback: true, holidays: DEFAULT_MOROCCAN_HOLIDAYS.map((h) => ({ ...h })) };
    const data = await resp.json();
    const res = validateHolidaysJsonSchema(data);
    return { ...res, fallback: !res.valid };
  } catch (e) {
    return {
      valid: false,
      fallback: true,
      reason: /** @type {Error} */ (e).message,
      holidays: DEFAULT_MOROCCAN_HOLIDAYS.map((h) => ({ ...h }))
    };
  }
}

export function findOperationsAffectedByHolidayChange(operations = [], holidays = DEFAULT_MOROCCAN_HOLIDAYS) {
  const affected = [];
  for (const op of operations || []) {
    if (!op || op.deletedAt) continue;
    const hitTranches = [];
    for (let idx = 0; idx < (op.tranches || []).length; idx++) {
      const tr = op.tranches[idx];
      if (!tr || tr.status === 'paid' || tr.status === 'cancelled' || tr.status === 'expired') continue;
      if (!isBusinessDay(tr.date, holidays)) {
        const info = getNonWorkingDayReason(tr.date, holidays);
        hitTranches.push({ idx, numCheque: tr.numCheque, date: tr.date, reason: info.reason });
      }
    }
    if (hitTranches.length > 0) {
      affected.push({ opId: op.id, beneficiaire: op.beneficiaire, hitTranches });
    }
  }
  return affected;
}
