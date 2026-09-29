# Video Script — Dhaka Tesla Pool (6:00 max)

This is a speaking script, not something to read verbatim on camera — say it
in your own words, but the content and structure below map directly to
Section 13's timing. Rough word counts are there to help you pace; aim to
speak a little slower than casual conversation since you're also
demonstrating things on screen.

**Before you hit record:**
- Have the app running (Docker Compose or manual) with fresh seed data
- Three browser windows/tabs logged in as Nusrat, Rafiq, and Jashim, so you
  can flip between passenger and driver views live
- `DESIGN.md`'s architecture diagram and ERD open in a tab, ready to show
- Know your route: Nusrat requests Banani→Farmgate (which passes through the
  Mohakhali junction), Rafiq requests Mohakhali→Farmgate (picked up along
  the way), Shirin requests Banani→Bashundhara (a different branch off the
  same junction — this is the rejection to demo live). The seat-race
  concurrency case is real but hard to time by hand, so it's mentioned as
  "tested automatically" rather than demoed live (see the note in the
  3:00–6:00 section)

---

## 0:00 – 1:00 — The problem, in your own words (~140 words)

*[ON SCREEN: your face, or the PRD's cover image / a plain title card — not the code yet]*

> The problem here is basically Dhaka rush hour, compressed into one street
> corner. Jashim's parked with Bullet, his three-seat battery rickshaw, and
> within about two minutes, three strangers show up wanting rides that
> overlap — but not exactly. Nusrat's headed toward Farmgate, which happens
> to pass right through a junction at Mohakhali. Rafiq shows up wanting to
> go from that same junction onward to Farmgate too — he can just be picked
> up along the way. Then Shirin shows up wanting a totally different
> direction off that same junction, and the system has to be smart enough to
> say no to her — not just stuff her in because there's a free seat.
>
> So the real problem isn't just "who's nearby." It's "whose route can
> actually share one vehicle without backtracking," who's willing to share
> with who, and does the driver know exactly who's in his car and what stage
> the trip's at. Three actors: Passenger, Driver/Tesla, and the Pool that
> ties them together.

---

## 1:00 – 3:00 — How you engineered it (~300 words)

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
> carry multiple ride requests.
>
> The decision I'd defend hardest is how matching actually works. My first
> version tagged each zone with a flat area label and pooled anyone in the
> same area — but that can't tell the difference between "genuinely on the
> way" and "needs the driver to backtrack through a junction." So I modeled
> the zones as a real road graph instead: each request gets its actual
> shortest path computed, and two requests can only share a vehicle if their
> paths merge into one continuous route, traveled the same direction. That
> rule is what correctly rejects Shirin in a minute.
>
> Consent works the same way I'd want it to work on me: when a driver wants
> to add someone to a pool I'm already in, I get a say — not just the person
> being added. Every existing member and the newcomer all have to agree; one
> "no" and the newcomer is removed, seat freed, back to waiting.
>
> And the concurrency problem — two passengers grabbing the last seat at the
> same instant — is one atomic SQL statement: update the seat count *and*
> check it fits under capacity, in the same `UPDATE ... WHERE`, not a read,
> then a check, then a write. I fired two simultaneous requests at the same
> pool in an automated test and got exactly one success, one clean
> rejection, every time.
>
> The trade-off I'll own upfront: auth is a JWT in `localStorage`, not an
> httpOnly cookie. Fine for an MVP, but readable by any JS on the page — I'd
> move to cookies plus CSRF before this went anywhere near production.

---

## 3:00 – 6:00 — Product tour (~440 words)

*[ON SCREEN: live app — switch between the three browser windows as noted]*

> Let's walk through it as the story. I'm signed in as Nusrat.
>
> *[Passenger view — request a ride]*
>
> I request Banani to Farmgate — one seat. The app shows me an estimated
> fare right away, base plus distance, with a note that pooling could take
> up to 20% off. No discount locked in yet, because I haven't been matched.
>
> *[Switch to Jashim's driver window]*
>
> Now I'm Jashim. Bullet's online, Nusrat's request is sitting in the open
> list. I accept it — since nobody's in a pool yet, there's nobody to ask,
> so she goes straight to matched. If Rafiq requests next, from Mohakhali to
> Farmgate — that's a stop right on Nusrat's own route — I can add him to
> that *same* pool.
>
> *[Switch to Rafiq's window, then Nusrat's]*
>
> But adding him doesn't instantly match him. Rafiq has to agree to share.
> And so does Nusrat — she's already in the pool, and she gets a say about
> sharing with *this* specific person too. Watch: Rafiq confirms... but
> he's still marked pending, because Nusrat hasn't answered yet. I flip to
> her screen, she approves, and now he flips to matched. Either one of them
> could have said no, and it would've bounced him back to an open request
> instead.
>
> *[Trigger the edge case]*
>
> Here's the edge case worth showing. Shirin wants Banani to Bashundhara —
> a completely different direction off the same junction Nusrat and Rafiq's
> route passes through. If I try to add her to this pool, the app rejects
> it outright. Not because of a zone tag — because her path genuinely can't
> merge with theirs without the vehicle turning around.
>
> *[Back to passenger status]*
>
> Notice the fares are still just estimates right now — no discount yet.
> That only locks in once I, the driver, mark the trip started, because
> that's the first moment the pool's membership is actually final.
>
> *[Driver view — arrive, start]*
>
> I mark arrived, then start — and now Nusrat and Rafiq's fares update to
> the final numbers. Checkable by hand: thirty taka base each, fifteen taka
> per kilometer over their own route distance, twenty percent off once
> pooled.
>
> One thing I won't demo live because it's genuinely hard to time by
> clicking — the actual last-seat race, two people grabbing the same seat
> at once — but that's exactly what the automated test suite fires on
> purpose, and it passes consistently: one wins, one gets a clean
> rejection, capacity never goes over.
>
> *[Complete the trip]*
>
> I complete the trip — both move to completed, and a payment record gets
> created for each of them.
>
> *[If deployed, show the live URL here; if not:]*
>
> This isn't deployed to a public URL yet — it runs reproducibly via Docker
> Compose, documented in the README along with why.

---

**Total spoken word count: ~880 words** — at a deliberate, explaining pace
(roughly 140–150 words/minute), that lands close to 6:00 including the
on-screen switches. Time yourself once before the real take; trim the
architecture section first if you're running long, since the product tour
is what the rubric weighs most under "product understanding."
