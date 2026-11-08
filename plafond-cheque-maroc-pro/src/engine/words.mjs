/**
 * Moroccan Banking Check Number-to-Words Converter
 * Supports both French ("Montant en toutes lettres FR") and Arabic ("تفقيط المبلغ بالعربية")
 * Fixes the French plural agreement rule: "deux cents dirhams" vs "deux cent mille dirhams"
 */

export function numberToFrenchWords(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return 'zéro';

  const units = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  const tens = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

  function convertBelow100(num, isFinalGroup) {
    if (num < 20) return units[num];
    const t = Math.floor(num / 10);
    const u = num % 10;
    if (t === 7 || t === 9) {
      const sub = 10 + u;
      const connector = (t === 7 && sub === 11) ? ' et ' : '-';
      return tens[t] + connector + units[sub];
    }
    if (u === 0) {
      return (t === 8 && isFinalGroup) ? 'quatre-vingts' : tens[t];
    }
    if (u === 1 && t !== 8) {
      return tens[t] + ' et un';
    }
    return tens[t] + '-' + units[u];
  }

  function convertBelow1000(num, isFinalGroup) {
    if (num < 100) return convertBelow100(num, isFinalGroup);
    const h = Math.floor(num / 100);
    const rem = num % 100;
    let head = h === 1 ? 'cent' : units[h] + ' cent';
    if (rem === 0 && h > 1 && isFinalGroup) {
      head += 's';
    }
    return rem === 0 ? head : head + ' ' + convertBelow100(rem, isFinalGroup);
  }

  const parts = [];
  const milliards = Math.floor(n / 1000000000);
  n %= 1000000000;
  const millions = Math.floor(n / 1000000);
  n %= 1000000;
  const milliers = Math.floor(n / 1000);
  const reste = n % 1000;

  if (milliards > 0) {
    parts.push(convertBelow1000(milliards, true) + (milliards > 1 ? ' milliards' : ' milliard'));
  }
  if (millions > 0) {
    parts.push(convertBelow1000(millions, true) + (millions > 1 ? ' millions' : ' million'));
  }
  if (milliers > 0) {
    if (milliers === 1) {
      parts.push('mille');
    } else {
      // Grammar rule: 'cent' and 'quatre-vingt' never take an 's' before 'mille'
      parts.push(convertBelow1000(milliers, false) + ' mille');
    }
  }
  if (reste > 0) {
    parts.push(convertBelow1000(reste, true));
  }

  return parts.join(' ').trim();
}

export function amountToMoroccanChequeWordsFR(amount) {
  const totalCentimes = Math.round(Math.abs(Number(amount) || 0) * 100);
  const whole = Math.floor(totalCentimes / 100);
  const centimes = totalCentimes % 100;
  let words = numberToFrenchWords(whole) + (whole > 1 ? ' dirhams' : ' dirham');
  if (centimes > 0) {
    words += ' et ' + numberToFrenchWords(centimes) + (centimes > 1 ? ' centimes' : ' centime');
  } else {
    words += ' exactement';
  }
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function numberToArabicWords(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return 'صفر';

  const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const tens = ['', 'عشرة', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const hundreds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

  function convertBelow1000Ar(num) {
    if (num === 0) return '';
    const h = Math.floor(num / 100);
    const rem = num % 100;
    const parts = [];
    if (h > 0) parts.push(hundreds[h]);
    if (rem > 0) {
      if (rem < 20) {
        parts.push(ones[rem]);
      } else {
        const u = rem % 10;
        const t = Math.floor(rem / 10);
        if (u > 0) {
          parts.push(ones[u] + ' و' + tens[t]);
        } else {
          parts.push(tens[t]);
        }
      }
    }
    return parts.join(' و');
  }

  const groups = [];
  const milliards = Math.floor(n / 1000000000);
  n %= 1000000000;
  const millions = Math.floor(n / 1000000);
  n %= 1000000;
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;

  if (milliards > 0) {
    if (milliards === 1) groups.push('مليار');
    else if (milliards === 2) groups.push('ملياران');
    else if (milliards >= 3 && milliards <= 10) groups.push(convertBelow1000Ar(milliards) + ' ملايير');
    else groups.push(convertBelow1000Ar(milliards) + ' مليار');
  }
  if (millions > 0) {
    if (millions === 1) groups.push('مليون');
    else if (millions === 2) groups.push('مليونان');
    else if (millions >= 3 && millions <= 10) groups.push(convertBelow1000Ar(millions) + ' ملايين');
    else groups.push(convertBelow1000Ar(millions) + ' مليون');
  }
  if (thousands > 0) {
    if (thousands === 1) groups.push('ألف');
    else if (thousands === 2) groups.push('ألفان');
    else if (thousands >= 3 && thousands <= 10) groups.push(convertBelow1000Ar(thousands) + ' آلاف');
    else groups.push(convertBelow1000Ar(thousands) + ' ألف');
  }
  if (rest > 0) {
    groups.push(convertBelow1000Ar(rest));
  }

  return groups.join(' و');
}

export function amountToMoroccanChequeWordsAR(amount) {
  const totalCentimes = Math.round(Math.abs(Number(amount) || 0) * 100);
  const whole = Math.floor(totalCentimes / 100);
  const centimes = totalCentimes % 100;
  let text = numberToArabicWords(whole) + ' درهم';
  if (centimes > 0) {
    text += ' و' + numberToArabicWords(centimes) + ' سنتيم';
  } else {
    text += ' فقط لا غير';
  }
  return text;
}
