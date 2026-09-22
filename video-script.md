# Video Script — Dhaka Tesla Pool (6:00 max)

This is a speaking script, not something to read verbatim on camera — say it
in your own words, but the content and structure below map directly to
Section 13's timing. Rough word counts are there to help you pace; aim to
speak a little slower than casual conversation since you're also
demonstrating things on screen.

**Before you hit record:**
- Have the app running (Docker Compose or manual) with fresh seed data
- Two browser windows/tabs logged in as different demo users (e.g. Nusrat
  and Jashim) so you can flip between passenger and driver views live
- `DESIGN.md`'s architecture diagram and ERD open in a tab, ready to show
- Know which edge case you're demoing (script below uses Shirin's
  incompatible-route rejection — easy to trigger live by clicking; the
  seat-race concurrency case is real but hard to time by hand, so it's
  mentioned as "tested automatically" rather than demoed live — see the note
  in the 3:00–6:00 section)

---

## 0:00 – 1:00 — The problem, in your own words (~140 words)

*[ON SCREEN: your face, or the PRD's cover image / a plain title card — not the code yet]*

> The problem here is basically Dhaka rush hour, compressed into one street
> corner. Jashim's parked with Bullet, his three-seat battery rickshaw, and
> within about two minutes, three strangers show up wanting rides that
> overlap — but not exactly. Nusrat's headed to Mohakhali, Rafiq's headed to
> Gulshan 1, both starting from Banani. Close enough in direction and
> distance that pooling them makes sense. Then Shirin shows up wanting to
> go somewhere completely different, and the system has to be smart enough
> to say no to her — not just stuff her in because there's a free seat.
>
> So the real problem isn't routing. It's decision-making in real time:
> who can actually share a ride, what's a fair price for each person
> individually, and does the driver know exactly who's in his car and what
> stage the trip's at. That's what I built around — three actors: Passenger,
> Driver/Tesla, and the Pool that ties them together.

---

## 1:00 – 3:00 — How you engineered it (~290 words)

*[ON SCREEN: architecture diagram first, then ERD, then briefly scroll through the actual folder structure / a couple of key files]*

> It's three pieces talking in one direction: browser, to a Next.js
> frontend, to an Express API, to Postgres. The frontend never touches the
> database directly — everything goes through the API, which is the only
> thing holding a DB credential.
>
> *[switch to ERD]*
>
> On the database side, the two tables that matter most are `pools` and
> `ride_requests`. A `ride_request` is one passenger's booking — their own
> status, their own fare. A `pool` is one Tesla's actual trip, which can
> carry multiple ride requests. I gave `ride_requests` a nullable `pool_id`
> foreign key instead of a separate join table, because a request only ever
> belongs to one pool — it doesn't switch vehicles mid-trip.
>
> The one decision I'd defend hardest is how I handled the concurrency
> problem — two passengers grabbing the last seat at the same instant. I
> used one atomic SQL statement: update the seat count *and* check it fits
> under capacity, in the same `UPDATE ... WHERE` — not a read, then a
> check, then a write in application code. That closes the race window
> completely, and I actually proved it — fired two simultaneous requests at
> the same pool in an automated test, and got exactly one success, one
> clean rejection, every time.
>
> The trade-off I'll own upfront: auth is a JWT stored in `localStorage`,
> not an httpOnly cookie. That's fine for an MVP, but it's readable by any
> JS on the page, so before this went anywhere near production I'd move to
> cookies plus CSRF protection. I'd rather say that myself than have it
> pointed out.

---

## 3:00 – 6:00 — Product tour (~420 words)

*[ON SCREEN: live app — switch between the two browser windows as noted]*

> Let's walk through it as the story. I'm signed in as Nusrat.
>
> *[Passenger view — request a ride]*
>
> I request Banani to Mohakhali — one seat. The app shows me an estimated
> fare right away, base fare plus distance, no pooling discount yet, because
> I haven't been matched to anyone. Status says "waiting for a driver."
>
> *[Switch to Jashim's driver window]*
>
> Now I'm Jashim. Bullet's online, and I can see Nusrat's request sitting
> in the open list. I accept it — that starts a new pool. If Rafiq requests
> right after, going to Gulshan 1, I can add him to that *same* pool,
> because his destination is close enough to Nusrat's — same pickup zone,
> compatible cluster.
>
> *[Trigger the edge case — try adding an incompatible request]*
>
> Here's the edge case worth showing: if Shirin requests a ride to somewhere
> like Mirpur — a totally different part of the city — and I try to add her
> to this same pool, the app rejects it. Route doesn't match. That's the
> matching rule actually being enforced, not just decoration.
>
> *[Back to passenger status]*
>
> Notice Nusrat's fare is still just an estimate at this point — no discount
> applied yet. That's deliberate: the pool discount only finalizes once I,
> as the driver, mark the trip started — because that's the first moment the
> pool's final size is actually locked in. Nobody can join after I mark
> arrival, so it's not fair to promise a discount before that's certain.
>
> *[Driver view — arrive, start]*
>
> I mark driver arrived, then start the trip — and now if I flip back to
> Nusrat and Rafiq's screens, their fares update to the final, discounted
> amount. Same math, ready to check by hand: thirty taka base, fifteen taka
> per kilometer, twenty percent off once they're pooled.
>
> One thing I won't demo live because it's genuinely hard to time by
> clicking — the actual last-seat race, two people grabbing the same seat
> at once — but that's exactly the scenario the automated test suite covers,
> and it passes consistently: one request wins, one gets a clean rejection,
> capacity never goes over.
>
> *[Complete the trip]*
>
> And I complete the trip — status moves to completed for both passengers,
> and a payment record gets created for each of them.
>
> *[If deployed, show the live URL here; if not:]*
>
> This isn't deployed to a public URL yet — it runs reproducibly via Docker
> Compose, which is documented in the README along with why.

---

**Total spoken word count: ~850 words** — at a deliberate, explaining pace
(roughly 140–150 words/minute), that lands close to 6:00 including the
on-screen switches. Time yourself once before the real take; trim the
architecture section first if you're running long, since the product tour
is what the rubric weighs most under "product understanding."
