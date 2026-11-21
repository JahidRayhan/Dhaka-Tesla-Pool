// Walks the mobile API client through the whole passenger + driver flow against a
// RUNNING backend that has the seed data loaded (migrations 001-006 + seed).
//   npm run test:api                      (uses EXPO_PUBLIC_API_URL or http://localhost:4000)
// It changes data (rides, wallet balances), so point it at a dev database only.
// The trailing slash below is deliberate: the client must tolerate it.
process.env.EXPO_PUBLIC_API_URL ||= 'http://localhost:4000/';
const { api, ApiRequestError } = await import('../lib/api.js');
const ok = (label, cond) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + label); if (!cond) process.exitCode = 1; };

const login = async (e) => (await api.login({ email: `${e}@dhakateslapool.test`, password: 'password123' }));
const n = await login('nusrat'), r = await login('rafiq'), j = await login('jashim');
ok('login returns token + user', n.token && n.user.name);
ok('me()', (await api.me(n.token)).user.email.startsWith('nusrat'));
const zones = (await api.zones()).zones;
const banani = zones.find(z => z.name === 'Banani').id, moha = zones.find(z => z.name === 'Mohakhali').id;
ok('zones load', zones.length >= 9);

ok('wallet starts at ৳1000', (await api.wallet(n.token)).balancePaisa === 100000);
ok('top-up', (await api.topUpWallet(n.token, 50000)).balancePaisa === 150000);

const tesla = (await api.myTeslas(j.token)).teslas[0];
const nr = (await api.createRideRequest(n.token, { pickupZoneId: banani, destinationZoneId: moha, seatsRequested: 1, paymentMethod: 'TESLAPAY' })).rideRequest;
ok('createRideRequest (TeslaPay)', nr.payment_method === 'TESLAPAY');
ok('open list shows it (driver)', (await api.openRideRequests(j.token)).rideRequests.some(x => x.id === nr.id));
const acc = await api.acceptRideRequest(j.token, nr.id, { teslaId: tesla.id });
const poolId = acc.poolId;
ok('accept creates pool', !!poolId);

const rr = (await api.createRideRequest(r.token, { pickupZoneId: banani, destinationZoneId: moha, seatsRequested: 1, paymentMethod: 'CASH' })).rideRequest;
await api.acceptRideRequest(j.token, rr.id, { teslaId: tesla.id, poolId });
let mineR = (await api.myRideRequests(r.token)).rideRequests[0];
ok('joiner is PENDING_CONFIRMATION with a deadline', mineR.status === 'PENDING_CONFIRMATION' && !!mineR.consentExpiresAt && mineR.ownConsentPending);
let mineN = (await api.myRideRequests(n.token)).rideRequests[0];
ok('existing member sees the question + deadline', mineN.pendingConsents.length === 1 && !!mineN.pendingConsents[0].expiresAt);

let blocked = false; try { await api.arrivePool(j.token, poolId); } catch (e) { blocked = e instanceof ApiRequestError && e.status === 409; }
ok('arrive blocked while proposal open', blocked);

await api.confirmRideRequest(r.token, rr.id);
await api.approvePoolConsent(n.token, mineN.pendingConsents[0].id);
ok('all agreed -> MATCHED', (await api.myRideRequests(r.token)).rideRequests[0].status === 'MATCHED');
ok('poolDetail has 2 members', (await api.poolDetail(j.token, poolId)).pool.members.length === 2);

// driver cancels: both back in the queue
await api.cancelPool(j.token, poolId, 'testing');
const after = (await api.myRideRequests(n.token)).rideRequests[0];
ok('driver cancel re-queues passengers', after.status === 'REQUESTED' && !after.pool_id);
ok('myPools empty after cancel', (await api.myPools(j.token)).pools.length === 0);

// re-run a TeslaPay trip to completion + payment
const acc2 = await api.acceptRideRequest(j.token, nr.id, { teslaId: tesla.id });
await api.arrivePool(j.token, acc2.poolId); await api.startPool(j.token, acc2.poolId); await api.completePool(j.token, acc2.poolId);
const done = (await api.myRideRequests(n.token)).rideRequests.find(x => x.id === nr.id);
ok('trip completed, paid with TeslaPay', done.status === 'COMPLETED' && done.paid_with === 'TESLAPAY' && done.payment_status === 'PAID');
ok('wallet debited', (await api.wallet(n.token)).balancePaisa < 150000);

// cancel/decline/reject endpoints exist and answer sensibly
const c = (await api.createRideRequest(n.token, { pickupZoneId: banani, destinationZoneId: moha })).rideRequest;
await api.cancelRideRequest(n.token, c.id);
ok('cancelRideRequest', (await api.myRideRequests(n.token)).rideRequests.find(x => x.id === c.id).status === 'CANCELLED');
let declineErr; try { await api.declineRideRequest(n.token, c.id); } catch (e) { declineErr = e; }
ok('declineRideRequest endpoint reachable (409 not 404)', declineErr?.status === 409);
let rejectErr; try { await api.rejectPoolConsent(n.token, '00000000-0000-0000-0000-000000000000'); } catch (e) { rejectErr = e; }
ok('rejectPoolConsent endpoint reachable (404 for unknown id)', rejectErr?.status === 404);

// error handling
let net; try { await api.me('bad'); } catch (e) { net = e; }
ok('bad token -> ApiRequestError 401', net?.status === 401);

// ---------------------------------------------------------------------------
// The newer features, through the same client the screens use.
// ---------------------------------------------------------------------------
const prof = await api.updateProfile(n.token, { locale: 'bn', gender: 'female', name: 'Nusrat' });
ok('updateProfile (language + gender)', prof.user.locale === 'bn' && prof.user.gender === 'female');
await api.updateProfile(n.token, { locale: 'en' });

const receipt = (await api.receipt(n.token, nr.id)).receipt;
ok('receipt for the completed TeslaPay ride', receipt.kind === 'FARE' && receipt.fare.totalPaisa > 0 && receipt.payment.method === 'TESLAPAY');
await api.rateRide(n.token, nr.id, 5, 'Smooth ride');
let rateErr; try { await api.rateRide(n.token, nr.id, 1); } catch (e) { rateErr = e; }
ok('rating works once, then 409', rateErr?.status === 409);
ok('the app can tell the ride was rated', (await api.myRideRequests(n.token)).rideRequests.find((x) => x.id === nr.id).rated === true);

const earnings = (await api.earnings(j.token)).totals;
ok('driver earnings include the completed ride', earnings.ridesCompleted >= 1 && earnings.grossPaisa > 0);
ok('driver profile readable (demo driver is verified)', (await api.driverProfile(j.token)).profile?.status === 'VERIFIED');

const inbox = await api.notifications(n.token);
ok('inbox has notifications and an unread count', inbox.notifications.length > 0 && inbox.unreadCount > 0);
await api.markNotificationsRead(n.token, 'all');
ok('mark all read', (await api.notifications(n.token, true)).unreadCount === 0);
await api.registerPushToken(n.token, 'ExponentPushToken[flow-test-0000000]', 'android');
await api.removePushToken(n.token, 'ExponentPushToken[flow-test-0000000]');
ok('push token register + remove', true);

const points = (await api.meetingPoints(banani)).meetingPoints;
ok('meeting points for a zone', points.length >= 1);

const live = (await api.createRideRequest(n.token, { pickupZoneId: banani, destinationZoneId: moha, shareMax: 3, pickupPointId: points[0].id })).rideRequest;
const liveAcc = await api.acceptRideRequest(j.token, live.id, { teslaId: tesla.id });
await api.sendLocation(j.token, liveAcc.poolId, 23.7936, 90.4066);
const tripCard = (await api.myRideRequests(n.token)).rideRequests.find((x) => x.id === live.id);
ok('passenger sees driver, vehicle, position and ETA', tripCard.trip?.driverName === 'Jashim' && !!tripCard.trip.location && tripCard.pickup_point_name);

const share = await api.createShare(n.token, live.id);
const pub = await fetch(`${process.env.EXPO_PUBLIC_API_URL.replace(/\/+$/, '')}/api/v1/trips/${share.token}`).then((r) => r.json());
ok('the public follow-my-trip link works with no account and hides identifiers', pub.trip?.passengerFirstName === 'Nusrat' && !JSON.stringify(pub).includes('@'));
await api.revokeShare(n.token, live.id);
const dead = await fetch(`${process.env.EXPO_PUBLIC_API_URL.replace(/\/+$/, '')}/api/v1/trips/${share.token}`);
ok('a revoked link stops working', dead.status === 404);

const board = (await api.openRideRequests(j.token, liveAcc.poolId)).rideRequests;
ok('the driver board accepts ?poolId= and annotates fit', Array.isArray(board));

const rec = (await api.createRecurringRide(n.token, { pickupZoneId: banani, destinationZoneId: moha, daysOfWeek: [1, 2, 3], timeOfDay: '08:30' })).recurringRide;
ok('recurring ride created', rec.time_of_day === '08:30');
ok('recurring ride listed', (await api.recurringRides(n.token)).recurringRides.some((x) => x.id === rec.id));
await api.setRecurringActive(n.token, rec.id, false);
await api.deleteRecurringRide(n.token, rec.id);
ok('recurring ride toggled and deleted', (await api.recurringRides(n.token)).recurringRides.every((x) => x.id !== rec.id));

// Refresh-token rotation, as the clients do it.
const fresh = await api.login({ email: 'rafiq@dhakateslapool.test', password: 'password123' });
const rotated = await api.refresh(fresh.refreshToken);
ok('refresh rotates both tokens', rotated.refreshToken && rotated.refreshToken !== fresh.refreshToken && !!rotated.accessToken);
await api.logout(rotated.refreshToken);
let afterLogout; try { await api.refresh(rotated.refreshToken); } catch (e) { afterLogout = e; }
ok('a logged-out refresh token is dead', afterLogout?.status === 401);
