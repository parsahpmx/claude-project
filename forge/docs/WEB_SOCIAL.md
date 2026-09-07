# Social model

Community is deliberately secondary to performance (§46). It is somewhere to
find a challenge or a club, not a feed to scroll.

## The graph

```
follows (follower_id, followee_id, status)   status: pending | accepted
blocks  (blocker_id, blocked_id)
```

- A follow is created **by the follower only**. The policy checks
  `follower_id = auth.uid()`, so nobody can add themselves to your followers.
- Approval is on by default, so a follow starts `pending`. The **followee**
  updates it; the follower can only withdraw.
- A follow toward someone who has blocked you is refused at insert.

## Blocking

Symmetric for visibility: if either party has blocked the other, neither sees
the other's content. `blocks` is readable only by the blocker — the blocked
person is never informed, which is the point of blocking.

## Visibility

One function decides, and every policy calls it:

```
private.can_view(viewer, owner, level)
```

| Level | Who sees it |
| --- | --- |
| `private` | The owner only |
| `followers` | Accepted followers, if neither party has blocked the other |
| `public` | Anyone, unless the owner's profile is private |

Anonymous visitors reach only `public` content on a `public` profile.

## The feed

Chronological, cursor-paginated, no ranking model (§23). It asks for recent
non-private activities and lets RLS decide which come back — it does not
reimplement the follow rules in TypeScript, because two implementations of one
rule is one implementation and one bug waiting.

## Clubs

A private club is invisible to non-members, including its existence in listings.
Membership of a private club is visible only to members. Admin actions are
gated on `private.is_club_admin`.

## Challenges

Metrics are constrained to distance, sessions, minutes and elevation. There is
no weight metric and no way to add one without a migration and a review.

## What is not built

Kudos, comments, follows and events all have tables and policies but no UI in
this beta. The schema is there so the shape does not have to change later; the
absence of the UI is deliberate rather than unfinished — §97 says not to delay
the beta for social features.

## Moderation

Not built. Before the feed and follows are opened to real users beyond the beta
cohort, this needs: report user, report activity, report comment, and an admin
path to remove content. Listed in `WEB_BETA_GO_NO_GO.md` as a condition on
enabling the social flags rather than as a beta blocker, because the beta ships
with them off.
