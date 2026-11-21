/**
 * What each notification says, in each language. Written server-side because a
 * push message is composed before it reaches the phone. Bangla copy should be
 * reviewed by a native speaker before launch; the structure makes that a
 * one-file edit.
 */
const taka = (paisa) => `৳${(Number(paisa) / 100).toFixed(2)}`;
const toBn = (s) => String(s).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);

const templates = {
  POOL_MATCHED: {
    en: (d) => ({ title: 'You have a Tesla', body: `${d.driverName} is coming in ${d.teslaName}.` }),
    bn: (d) => ({ title: 'আপনার টেসলা ঠিক হয়েছে', body: `${d.driverName} ${d.teslaName} নিয়ে আসছেন।` }),
  },
  SHARE_REQUEST: {
    en: (d) => ({ title: 'Share your ride?', body: `${d.joinerName} wants to join your ride. Answer within ${d.minutes} minutes.` }),
    bn: (d) => ({ title: 'রাইড শেয়ার করবেন?', body: `${d.joinerName} আপনার রাইডে যোগ দিতে চান। ${toBn(d.minutes)} মিনিটের মধ্যে উত্তর দিন।` }),
  },
  SHARE_CONFIRM: {
    en: (d) => ({ title: 'Confirm sharing', body: `A driver wants to add you to a shared ride. Confirm within ${d.minutes} minutes.` }),
    bn: (d) => ({ title: 'শেয়ার নিশ্চিত করুন', body: `একজন চালক আপনাকে শেয়ার করা রাইডে যোগ করতে চান। ${toBn(d.minutes)} মিনিটের মধ্যে নিশ্চিত করুন।` }),
  },
  SHARE_ACCEPTED: {
    en: () => ({ title: 'Pool confirmed', body: 'Everyone agreed to share. Your ride is on.' }),
    bn: () => ({ title: 'পুল নিশ্চিত', body: 'সবাই শেয়ারে রাজি। আপনার রাইড ঠিক আছে।' }),
  },
  SHARE_REJECTED: {
    en: () => ({ title: 'Sharing did not go ahead', body: "You're back in the queue for another driver." }),
    bn: () => ({ title: 'শেয়ার হয়নি', body: 'আপনি আবার অন্য চালকের অপেক্ষায় আছেন।' }),
  },
  SHARE_EXPIRED: {
    en: () => ({ title: 'Sharing request timed out', body: 'Nobody answered in time, so the pool stays as it was.' }),
    bn: () => ({ title: 'শেয়ারের সময় শেষ', body: 'সময়মতো উত্তর আসেনি, তাই পুল আগের মতোই আছে।' }),
  },
  DRIVER_ARRIVED: {
    en: (d) => ({ title: 'Your driver has arrived', body: `${d.driverName} is waiting for you.` }),
    bn: (d) => ({ title: 'আপনার চালক পৌঁছেছেন', body: `${d.driverName} আপনার জন্য অপেক্ষা করছেন।` }),
  },
  TRIP_STARTED: {
    en: () => ({ title: 'Trip started', body: 'Have a safe ride.' }),
    bn: () => ({ title: 'যাত্রা শুরু', body: 'নিরাপদ যাত্রা কামনা করছি।' }),
  },
  TRIP_COMPLETED: {
    en: (d) => ({ title: 'Trip complete', body: `Your fare: ${taka(d.farePaisa)}. Please rate your driver.` }),
    bn: (d) => ({ title: 'যাত্রা শেষ', body: `আপনার ভাড়া: ${toBn(taka(d.farePaisa))}। চালককে রেটিং দিন।` }),
  },
  POOL_CANCELLED_BY_DRIVER: {
    en: () => ({ title: 'Your driver cancelled', body: "You're back in the queue — we'll find you another driver." }),
    bn: () => ({ title: 'চালক বাতিল করেছেন', body: 'আপনি আবার অপেক্ষায় আছেন — আমরা অন্য চালক খুঁজব।' }),
  },
  NO_SHOW: {
    en: (d) => ({ title: 'You missed your ride', body: `The driver waited. A no-show fee of ${taka(d.feePaisa)} applies.` }),
    bn: (d) => ({ title: 'আপনি রাইড মিস করেছেন', body: `চালক অপেক্ষা করেছিলেন। ${toBn(taka(d.feePaisa))} নো-শো ফি প্রযোজ্য।` }),
  },
  REQUEST_EXPIRED: {
    en: (d) => ({ title: 'No pool found', body: `We couldn't find a driver within ${d.minutes} minutes, so the request was cancelled.` }),
    bn: (d) => ({ title: 'কোনো পুল পাওয়া যায়নি', body: `${toBn(d.minutes)} মিনিটের মধ্যে চালক পাওয়া যায়নি, তাই অনুরোধ বাতিল হয়েছে।` }),
  },
  RECURRING_RIDE_CREATED: {
    en: (d) => ({ title: 'Your commute is booked', body: `${d.route} is scheduled for ${d.time}.` }),
    bn: (d) => ({ title: 'আপনার নিয়মিত যাত্রা বুক হয়েছে', body: `${d.route} — ${toBn(d.time)} এ নির্ধারিত।` }),
  },
  RECURRING_RIDE_FAILED: {
    en: (d) => ({ title: "Couldn't book your commute", body: `${d.route}: ${d.reason}` }),
    bn: (d) => ({ title: 'নিয়মিত যাত্রা বুক করা যায়নি', body: `${d.route}: ${d.reason}` }),
  },
  DRIVER_VERIFIED: {
    en: () => ({ title: "You're verified", body: 'You can now go online and accept rides.' }),
    bn: () => ({ title: 'আপনি যাচাইকৃত', body: 'এখন আপনি অনলাইনে গিয়ে রাইড নিতে পারবেন।' }),
  },
  DRIVER_REJECTED: {
    en: (d) => ({ title: 'Verification not approved', body: d.note || 'Please check your details and submit again.' }),
    bn: (d) => ({ title: 'যাচাই অনুমোদিত হয়নি', body: d.note || 'আপনার তথ্য দেখে আবার জমা দিন।' }),
  },
};

function render(type, data, locale = 'en') {
  const t = templates[type];
  if (!t) return { title: type, body: '' };
  return (t[locale] || t.en)(data || {});
}

module.exports = { render, templates };
