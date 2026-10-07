import type { MapPoint } from './MapViews';
import type { NearbyPlace, PlaceCategory } from './types';

export const placeLabel = (category: PlaceCategory, language: string) => {
  const names: Record<PlaceCategory, [string, string]> = {
    police: ['Police stations', 'থানা ও পুলিশ স্টেশন'],
    fire: ['Fire stations', 'ফায়ার স্টেশন'],
    mosque: ['Mosques', 'মসজিদ'],
    temple: ['Temples', 'মন্দির'],
    market: ['Markets', 'বাজার'],
    hospital: ['Hospitals', 'হাসপাতাল'],
    school: ['Schools', 'বিদ্যালয়'],
    college: ['Colleges', 'কলেজ'],
    university: ['Universities', 'বিশ্ববিদ্যালয়']
  };
  return names[category][language === 'bn' ? 1 : 0];
};
export const placeDistance = (metres: number, language: string) =>
  metres < 1000 ? `${metres} ${language === 'bn' ? 'মিটার' : 'm'}` : `${(metres / 1000).toFixed(1)} ${language === 'bn' ? 'কিমি' : 'km'}`;
export const directionsUrl = (origin: MapPoint, place: NearbyPlace, mode: 'walking' | 'driving') => {
  const url = new URL('https://www.google.com/maps/dir/');
  url.search = new URLSearchParams({
    api: '1',
    origin: `${origin.latitude},${origin.longitude}`,
    destination: `${place.latitude},${place.longitude}`,
    travelmode: mode
  }).toString();
  return url.href;
};
