// Pure translation data and helpers (no React), so they can be unit-tested.
// Bangla copy should be reviewed by a native speaker before a public launch.

export const en = {
  appName: 'Dhaka Tesla Pool',
  loading: 'Loading…', retry: 'Try again', cancel: 'Cancel', save: 'Save', saved: 'Saved', close: 'Close', back: 'Back',
  signIn: 'Sign in', createAccount: 'Create an account', signOut: 'Sign out', yes: 'Yes', no: 'No',
  seat_one: '{n} seat', seat_other: '{n} seats', minLeft: '{n} min left', expiringNow: 'expiring now',

  areas: 'BANANI · GULSHAN · MOHAKHALI',
  heroTitle: 'Share a seat.\nSplit the fare.\nSurvive Dhaka traffic.',
  heroSubtitle: 'Request a Tesla, pool with someone headed your way, and see exactly what you owe before you get in.',

  email: 'Email', password: 'Password', name: 'Name', phone: 'Phone', phoneOptional: 'Phone (optional)',
  passwordHint: 'Password (8+ characters)', passwordTooShort: 'Password must be at least 8 characters.',
  iWantTo: 'I want to', bookRides: 'Book rides', driveTesla: 'Drive a Tesla', newHere: 'New here?', haveAccount: 'Have an account?',
  forgotPassword: 'Forgot password?', resetPassword: 'Reset password', sendCode: 'Send code', codeSent: 'We sent a 6-digit code by SMS.',
  code: 'Code', newPassword: 'New password', passwordChanged: 'Password changed. Please sign in.',
  signInFailed: 'Could not sign in.', signUpFailed: 'Could not create your account.',

  tabRide: 'Ride', tabDrive: 'Drive', tabActivity: 'Activity', tabAccount: 'Account',

  requestRide: 'Request a ride', pickup: 'Pickup', dropoff: 'Drop-off', seats: 'Seats', payWith: 'Pay with',
  cash: 'Cash', teslaPay: 'TeslaPay', wallet: 'Wallet', add: 'Add', adding: 'Adding…', requestTesla: 'Request a Tesla',
  yourRides: 'Your rides', noRides: 'No rides yet — request one above to get started.',
  moreOptions: 'More options', fewerOptions: 'Fewer options',
  when: 'When', now: 'Now', in30: 'In 30 min', in60: 'In 1 hour', in120: 'In 2 hours',
  waitUpTo: 'Wait up to', min15: '15 min', min30: '30 min', min60: '1 hour', min120: '2 hours',
  sharing: 'Sharing', askEachTime: 'Ask me each time', upTo2: 'Up to 2 people', upTo3: 'Up to 3 people',
  sharingHelp: 'Say yes now and you will not be asked again for a pool inside that size.',
  womenOnly: 'Women-only ride', womenOnlyHelp: 'Only pooled with women passengers.', womenOnlyNeedsGender: 'Set your gender in Account to use women-only rides.',
  meetingPoint: 'Meeting point', anywhereIn: 'Anywhere in {zone}',
  samePlaceError: 'Pickup and destination must be different areas.',
  scheduledFor: 'Scheduled for {time}',

  s_REQUESTED: 'Waiting for a driver', s_PENDING_CONFIRMATION: 'Confirm sharing your ride', s_MATCHED: 'Matched',
  s_DRIVER_ARRIVED: 'Driver has arrived', s_STARTED: 'On the way', s_COMPLETED: 'Completed', s_CANCELLED: 'Cancelled',

  estimateNote: 'estimate · up to {pct}% off if pooled', paysWithTeslaPay: 'pays with TeslaPay', paidWithTeslaPay: 'paid with TeslaPay',
  payDriverCash: 'pay driver in cash', walletShortCash: 'wallet was short · pay driver in cash',
  sharingWith: 'Sharing with {names}',
  consentJoiner: 'The driver wants to share this ride with {names}, going to {places}.', consentJoinerNoNames: 'The driver wants to add you to a shared ride.',
  consentTail: 'Everyone has to agree — including them. Your seat is held meanwhile.', answerInTime: 'Answer in time: {left}.',
  confirmSharing: 'Confirm sharing', dontShare: "Don't share — keep waiting", cancelRideEntirely: 'Cancel ride entirely',
  youAgreed: "You've agreed.", waitingFor: 'Waiting for {names} to agree too.',
  proposedToShare: '{name} is being proposed to share your ride — picked up at {pickup}, going to {dest}. Are you OK sharing with them?',
  yesShare: 'Yes, share', noKeepMine: 'No, keep my ride as it is',
  driverLabel: 'Driver', vehicleLabel: 'Vehicle', plateLabel: 'Plate', etaAbout: 'About {n} min away', etaNote: 'ETA is an estimate from straight-line distance.',
  rateDriver: 'Rate your driver', ratePassenger: 'Rate this passenger', thanksRating: 'Thanks for rating!', submitRating: 'Submit rating',
  receipt: 'Receipt', shareTrip: 'Share my trip', stopSharing: 'Stop sharing', shareMessage: 'Follow my Dhaka Tesla Pool trip: {url}',
  shareFailed: 'Could not create the link.', baseFare: 'Base fare', distanceCharge: 'Distance', poolDiscount: 'Pool discount', total: 'Total',
  noShowFee: 'No-show fee', sharedWithCount: 'Shared with {n} other passenger(s)', paidBy: 'Paid by {method} ({status})',
  paymentPaid: 'paid', paymentPending: 'to pay', route: 'Route',

  walletTitle: 'TeslaPay wallet', balance: 'Balance', topUpNote: 'Top-ups are a simulation while online payments are being set up.',
  topUpUnavailable: 'Adding money is not available yet.',

  registerTesla: 'Register your Tesla', teslaName: 'Name', teslaSeats: 'Seats (1–6)', register: 'Register',
  online: '● Online', goOnline: 'Go online', goOnlineToSee: 'Go online to see requests.',
  activePool: 'Active pool', openRequests: 'Open requests', noOpenRequests: 'No open requests right now.',
  accept: 'Accept', addToPool: 'Add to pool', markArrived: 'Mark driver arrived', startTrip: 'Start trip', completeTrip: 'Complete trip',
  cancelPool: 'Cancel pool', cancelPoolTitle: 'Cancel this pool?', cancelPoolBody: 'Everyone in it goes back to waiting for a driver.', keepPool: 'Keep pool',
  cancelling: 'Cancelling…', blockedByProposal: 'A newcomer is waiting on the pool to agree to share — everyone has to say yes (within 5 minutes) before you can arrive.',
  fitsPool: 'Fits your pool', detourPct: '{n}% detour', whyNot_SEATS: 'Not enough free seats', whyNot_WOMEN_ONLY: 'Women-only mismatch',
  whyNot_ROUTE: "Route doesn't match", whyNot_POOL_BUSY: 'Answer the open sharing question first',
  noShow: 'Passenger did not show up', noShowTitle: 'Mark as no-show?', noShowBody: 'The passenger is charged a small fee and their seat is released.',
  noShowWait: 'You can do this {n} minutes after arriving.', shareLocation: 'Share my location with passengers', locationDenied: 'Location permission was not granted.',
  earnings: 'Earnings (last 30 days)', ridesDone: 'Rides', grossLabel: 'Total', walletPaid: 'Paid to wallet', cashToCollect: 'Cash to collect',
  verification: 'Verification', verifyIntro: 'Submit your licence and plate so riders can trust you.', licenseNumber: 'Licence number', vehiclePlate: 'Vehicle plate',
  submitForReview: 'Submit for review', v_PENDING: 'Being reviewed', v_VERIFIED: 'Verified', v_REJECTED: 'Not approved', v_NONE: 'Not submitted',

  activity: 'Notifications', noNotifications: 'Nothing yet. Updates about your rides will appear here.', markAllRead: 'Mark all read',

  account: 'Account', language: 'Language', english: 'English', bangla: 'বাংলা', gender: 'Gender',
  g_female: 'Female', g_male: 'Male', g_other: 'Other', g_unset: 'Prefer not to say', genderHelp: 'Only used for women-only rides.',
  verifyPhoneTitle: 'Verify your phone', phoneVerified: 'Phone verified', phoneNotVerified: 'Phone not verified', verifyNow: 'Send verification code',
  enterCode: 'Enter the 6-digit code', verify: 'Verify',
  commutes: 'Repeating rides', commutesHelp: 'Book the same ride on the days you choose. We book it an hour before.',
  noCommutes: 'No repeating rides yet.', addCommute: 'Add a repeating ride', days: 'Days', time: 'Time (Dhaka)', create: 'Create', delete: 'Delete',
  d1: 'Mon', d2: 'Tue', d3: 'Wed', d4: 'Thu', d5: 'Fri', d6: 'Sat', d7: 'Sun',
  signOutEverywhere: 'Sign out on all devices', adminOnWeb: 'Operators use the web console.',
  genericError: 'Something went wrong. Please try again.',
};

export const bn = {
  appName: 'ঢাকা টেসলা পুল',
  loading: 'লোড হচ্ছে…', retry: 'আবার চেষ্টা করুন', cancel: 'বাতিল', save: 'সংরক্ষণ', saved: 'সংরক্ষিত', close: 'বন্ধ', back: 'পিছনে',
  signIn: 'সাইন ইন', createAccount: 'অ্যাকাউন্ট খুলুন', signOut: 'সাইন আউট', yes: 'হ্যাঁ', no: 'না',
  seat_one: '{n}টি সিট', seat_other: '{n}টি সিট', minLeft: '{n} মিনিট বাকি', expiringNow: 'এখনই শেষ হচ্ছে',

  areas: 'বনানী · গুলশান · মহাখালী',
  heroTitle: 'একটি সিট ভাগ করুন।\nভাড়া ভাগ করুন।\nঢাকার যানজট পার করুন।',
  heroSubtitle: 'একটি টেসলা অনুরোধ করুন, একই পথের কারও সাথে ভাগ করুন, এবং ওঠার আগেই জানুন কত দিতে হবে।',

  email: 'ইমেইল', password: 'পাসওয়ার্ড', name: 'নাম', phone: 'ফোন', phoneOptional: 'ফোন (ঐচ্ছিক)',
  passwordHint: 'পাসওয়ার্ড (কমপক্ষে ৮ অক্ষর)', passwordTooShort: 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।',
  iWantTo: 'আমি চাই', bookRides: 'রাইড বুক করতে', driveTesla: 'টেসলা চালাতে', newHere: 'নতুন?', haveAccount: 'অ্যাকাউন্ট আছে?',
  forgotPassword: 'পাসওয়ার্ড ভুলে গেছেন?', resetPassword: 'পাসওয়ার্ড রিসেট', sendCode: 'কোড পাঠান', codeSent: 'এসএমএসে ৬ সংখ্যার কোড পাঠানো হয়েছে।',
  code: 'কোড', newPassword: 'নতুন পাসওয়ার্ড', passwordChanged: 'পাসওয়ার্ড বদলেছে। এখন সাইন ইন করুন।',
  signInFailed: 'সাইন ইন করা যায়নি।', signUpFailed: 'অ্যাকাউন্ট খোলা যায়নি।',

  tabRide: 'রাইড', tabDrive: 'চালান', tabActivity: 'আপডেট', tabAccount: 'অ্যাকাউন্ট',

  requestRide: 'রাইড অনুরোধ', pickup: 'ওঠার জায়গা', dropoff: 'নামার জায়গা', seats: 'সিট', payWith: 'পরিশোধ',
  cash: 'নগদ', teslaPay: 'টেসলাপে', wallet: 'ওয়ালেট', add: 'যোগ করুন', adding: 'যোগ হচ্ছে…', requestTesla: 'টেসলা অনুরোধ করুন',
  yourRides: 'আপনার রাইড', noRides: 'এখনও কোনো রাইড নেই — শুরু করতে উপরে অনুরোধ করুন।',
  moreOptions: 'আরও অপশন', fewerOptions: 'কম অপশন',
  when: 'কখন', now: 'এখনই', in30: '৩০ মিনিট পরে', in60: '১ ঘণ্টা পরে', in120: '২ ঘণ্টা পরে',
  waitUpTo: 'অপেক্ষা করব', min15: '১৫ মিনিট', min30: '৩০ মিনিট', min60: '১ ঘণ্টা', min120: '২ ঘণ্টা',
  sharing: 'শেয়ারিং', askEachTime: 'প্রতিবার জিজ্ঞেস করুন', upTo2: 'সর্বোচ্চ ২ জন', upTo3: 'সর্বোচ্চ ৩ জন',
  sharingHelp: 'এখন হ্যাঁ বললে এই সংখ্যার মধ্যের পুলের জন্য আর জিজ্ঞেস করা হবে না।',
  womenOnly: 'শুধু নারী যাত্রী', womenOnlyHelp: 'শুধু নারী যাত্রীদের সাথে পুল হবে।', womenOnlyNeedsGender: 'এটি ব্যবহার করতে অ্যাকাউন্টে আপনার লিঙ্গ দিন।',
  meetingPoint: 'মিলনস্থল', anywhereIn: '{zone}-এর যেকোনো জায়গা',
  samePlaceError: 'ওঠার ও নামার এলাকা আলাদা হতে হবে।',
  scheduledFor: '{time}-এ নির্ধারিত',

  s_REQUESTED: 'চালকের অপেক্ষায়', s_PENDING_CONFIRMATION: 'রাইড শেয়ার নিশ্চিত করুন', s_MATCHED: 'ঠিক হয়েছে',
  s_DRIVER_ARRIVED: 'চালক পৌঁছেছেন', s_STARTED: 'পথে', s_COMPLETED: 'সম্পন্ন', s_CANCELLED: 'বাতিল',

  estimateNote: 'আনুমানিক · পুল হলে সর্বোচ্চ {pct}% ছাড়', paysWithTeslaPay: 'টেসলাপে দিয়ে পরিশোধ', paidWithTeslaPay: 'টেসলাপে দিয়ে পরিশোধিত',
  payDriverCash: 'চালককে নগদ দিন', walletShortCash: 'ওয়ালেটে টাকা কম ছিল · চালককে নগদ দিন',
  sharingWith: '{names}-এর সাথে শেয়ার',
  consentJoiner: 'চালক এই রাইড {names}-এর সাথে শেয়ার করতে চান, গন্তব্য {places}।', consentJoinerNoNames: 'চালক আপনাকে একটি শেয়ার করা রাইডে যোগ করতে চান।',
  consentTail: 'সবাইকে রাজি হতে হবে — আপনিও। ততক্ষণ আপনার সিট ধরে রাখা হয়েছে।', answerInTime: 'সময়মতো উত্তর দিন: {left}।',
  confirmSharing: 'শেয়ার নিশ্চিত করুন', dontShare: 'শেয়ার করব না — অপেক্ষা করব', cancelRideEntirely: 'রাইড পুরোপুরি বাতিল',
  youAgreed: 'আপনি রাজি হয়েছেন।', waitingFor: '{names}-এর রাজি হওয়ার অপেক্ষা।',
  proposedToShare: '{name} আপনার রাইডে যোগ দিতে চান — {pickup} থেকে {dest}-এ। আপনি কি রাজি?',
  yesShare: 'হ্যাঁ, শেয়ার করব', noKeepMine: 'না, আমার রাইড যেমন আছে থাক',
  driverLabel: 'চালক', vehicleLabel: 'গাড়ি', plateLabel: 'নম্বর প্লেট', etaAbout: 'প্রায় {n} মিনিট দূরে', etaNote: 'সময়টি সরলরেখার দূরত্ব থেকে অনুমান করা।',
  rateDriver: 'চালককে রেটিং দিন', ratePassenger: 'যাত্রীকে রেটিং দিন', thanksRating: 'রেটিং দেওয়ার জন্য ধন্যবাদ!', submitRating: 'রেটিং পাঠান',
  receipt: 'রসিদ', shareTrip: 'আমার যাত্রা শেয়ার করুন', stopSharing: 'শেয়ার বন্ধ করুন', shareMessage: 'আমার ঢাকা টেসলা পুল যাত্রা অনুসরণ করুন: {url}',
  shareFailed: 'লিঙ্ক তৈরি করা যায়নি।', baseFare: 'মূল ভাড়া', distanceCharge: 'দূরত্বের ভাড়া', poolDiscount: 'পুল ছাড়', total: 'মোট',
  noShowFee: 'নো-শো ফি', sharedWithCount: 'আরও {n} জন যাত্রীর সাথে শেয়ার', paidBy: 'পরিশোধ: {method} ({status})',
  paymentPaid: 'পরিশোধিত', paymentPending: 'পরিশোধ বাকি', route: 'পথ',

  walletTitle: 'টেসলাপে ওয়ালেট', balance: 'ব্যালেন্স', topUpNote: 'অনলাইন পেমেন্ট চালু হওয়ার আগে টপ-আপ একটি পরীক্ষামূলক ব্যবস্থা।',
  topUpUnavailable: 'এখন টাকা যোগ করা যাচ্ছে না।',

  registerTesla: 'আপনার টেসলা নিবন্ধন করুন', teslaName: 'নাম', teslaSeats: 'সিট (১–৬)', register: 'নিবন্ধন',
  online: '● অনলাইন', goOnline: 'অনলাইনে যান', goOnlineToSee: 'অনুরোধ দেখতে অনলাইনে যান।',
  activePool: 'চলমান পুল', openRequests: 'খোলা অনুরোধ', noOpenRequests: 'এখন কোনো খোলা অনুরোধ নেই।',
  accept: 'গ্রহণ', addToPool: 'পুলে যোগ করুন', markArrived: 'পৌঁছেছি', startTrip: 'যাত্রা শুরু', completeTrip: 'যাত্রা শেষ',
  cancelPool: 'পুল বাতিল', cancelPoolTitle: 'এই পুল বাতিল করবেন?', cancelPoolBody: 'পুলের সবাই আবার চালকের অপেক্ষায় ফিরে যাবেন।', keepPool: 'পুল রাখুন',
  cancelling: 'বাতিল হচ্ছে…', blockedByProposal: 'একজন নতুন যাত্রী যোগ হতে চান — পৌঁছানোর আগে সবাইকে (৫ মিনিটের মধ্যে) রাজি হতে হবে।',
  fitsPool: 'আপনার পুলে মানানসই', detourPct: '{n}% ঘুরপথ', whyNot_SEATS: 'পর্যাপ্ত খালি সিট নেই', whyNot_WOMEN_ONLY: 'শুধু-নারী পুলের সাথে মেলে না',
  whyNot_ROUTE: 'পথ মেলে না', whyNot_POOL_BUSY: 'আগে খোলা শেয়ারের প্রশ্নের উত্তর হোক',
  noShow: 'যাত্রী আসেননি', noShowTitle: 'যাত্রী আসেননি বলে চিহ্নিত করবেন?', noShowBody: 'যাত্রীর কাছ থেকে সামান্য ফি নেওয়া হবে এবং তাঁর সিট ছেড়ে দেওয়া হবে।',
  noShowWait: 'পৌঁছানোর {n} মিনিট পরে এটি করা যাবে।', shareLocation: 'যাত্রীদের সাথে আমার লোকেশন শেয়ার করুন', locationDenied: 'লোকেশনের অনুমতি দেওয়া হয়নি।',
  earnings: 'আয় (গত ৩০ দিন)', ridesDone: 'রাইড', grossLabel: 'মোট', walletPaid: 'ওয়ালেটে পরিশোধিত', cashToCollect: 'নগদ আদায় বাকি',
  verification: 'যাচাই', verifyIntro: 'আপনার লাইসেন্স ও নম্বর প্লেট জমা দিন, যাতে যাত্রীরা আপনাকে বিশ্বাস করতে পারেন।', licenseNumber: 'লাইসেন্স নম্বর', vehiclePlate: 'গাড়ির নম্বর প্লেট',
  submitForReview: 'যাচাইয়ের জন্য জমা দিন', v_PENDING: 'যাচাই চলছে', v_VERIFIED: 'যাচাইকৃত', v_REJECTED: 'অনুমোদিত হয়নি', v_NONE: 'জমা দেওয়া হয়নি',

  activity: 'আপডেট', noNotifications: 'এখনও কিছু নেই। আপনার রাইডের আপডেট এখানে দেখা যাবে।', markAllRead: 'সব পড়া হয়েছে',

  account: 'অ্যাকাউন্ট', language: 'ভাষা', english: 'English', bangla: 'বাংলা', gender: 'লিঙ্গ',
  g_female: 'নারী', g_male: 'পুরুষ', g_other: 'অন্যান্য', g_unset: 'বলতে চাই না', genderHelp: 'শুধু শুধু-নারী রাইডের জন্য ব্যবহৃত হয়।',
  verifyPhoneTitle: 'আপনার ফোন যাচাই করুন', phoneVerified: 'ফোন যাচাইকৃত', phoneNotVerified: 'ফোন যাচাই হয়নি', verifyNow: 'যাচাইয়ের কোড পাঠান',
  enterCode: '৬ সংখ্যার কোডটি দিন', verify: 'যাচাই করুন',
  commutes: 'নিয়মিত রাইড', commutesHelp: 'আপনার বেছে নেওয়া দিনগুলোতে একই রাইড বুক হবে। এক ঘণ্টা আগে আমরা বুক করব।',
  noCommutes: 'এখনও কোনো নিয়মিত রাইড নেই।', addCommute: 'নিয়মিত রাইড যোগ করুন', days: 'দিন', time: 'সময় (ঢাকা)', create: 'তৈরি করুন', delete: 'মুছুন',
  d1: 'সোম', d2: 'মঙ্গল', d3: 'বুধ', d4: 'বৃহস্পতি', d5: 'শুক্র', d6: 'শনি', d7: 'রবি',
  signOutEverywhere: 'সব ডিভাইস থেকে সাইন আউট', adminOnWeb: 'অপারেটররা ওয়েব কনসোল ব্যবহার করুন।',
  genericError: 'কিছু ভুল হয়েছে। আবার চেষ্টা করুন।',
};

export const DICTIONARIES = { en, bn };
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/** "৳205.66" -> "৳২০৫.৬৬" for Bangla; unchanged for English. */
export function localizeDigits(text, lang) {
  return lang === 'bn' ? String(text).replace(/\d/g, (d) => BN_DIGITS[Number(d)]) : String(text);
}

/** Looks a key up (falling back to English, then to the key itself) and fills {placeholders}. */
export function translate(lang, key, vars = {}) {
  const raw = DICTIONARIES[lang]?.[key] ?? en[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, name) => (vars[name] === undefined ? `{${name}}` : localizeDigits(vars[name], lang)));
}

export function plural(lang, key, n) {
  return translate(lang, `${key}_${n === 1 ? 'one' : 'other'}`, { n });
}

/** Picks the starting language from a device locale string such as "bn-BD" or "en-US". */
export function pickInitialLanguage(deviceLocale) {
  return typeof deviceLocale === 'string' && deviceLocale.toLowerCase().startsWith('bn') ? 'bn' : 'en';
}
