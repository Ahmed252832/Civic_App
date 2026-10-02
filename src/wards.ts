import wardLimits from '../shared/wards.json';

export const wardOptions = Object.entries(wardLimits).flatMap(([corporation, count]) =>
  Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return { code: `${corporation}-${number}`, corporation, number };
  })
);

export const wardLabel = (code: string | null | undefined, language: 'en' | 'bn' = 'en') => {
  if (!code) return language === 'bn' ? 'পুরোনো এলাকা (ওয়ার্ড নির্ধারিত নয়)' : 'Legacy area (ward not assigned)';
  const ward = wardOptions.find(item => item.code === code);
  if (!ward) return code;
  const city = language === 'bn' ? (ward.corporation === 'DNCC' ? 'ঢাকা উত্তর' : 'ঢাকা দক্ষিণ') : ward.corporation;
  const number = language === 'bn' ? ward.number.replace(/[0-9]/g, digit => '০১২৩৪৫৬৭৮৯'[Number(digit)]) : ward.number;
  return language === 'bn' ? `${city} · ওয়ার্ড ${number}` : `${city} Ward ${number}`;
};

export const isWard = (code: string) => wardOptions.some(item => item.code === code);
