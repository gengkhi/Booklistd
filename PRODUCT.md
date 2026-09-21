# PRODUCT.md — Booklistd

## What this is
A personal digital library app (iOS + Android, one Expo/React Native codebase) where people catalog every book they physically own — and, in a bookstore, know in under a second whether they already own the book in their hand.

## Audience
Book owners with 50–2,000+ physical books: rereaders, collectors, families with overflowing shelves. They currently use spreadsheets, Goodreads (which tracks reading, not ownership), or nothing. Cross-platform matters: the polished incumbents (BookBuddy, Book Track, Bookshelf) are iOS-only.

## The core promise (priority order)
1. Scan — fast, continuous, hands-free
2. Search — my shelves first, then the catalog
3. Know immediately if I own it (Store Mode verdict)
4. Add a book in one tap
5. Track reading separately from owning — Want to read, Reading, Read, Did not finish — so a library read still counts and a wishlist stays about owning

## Killer feature — Store Mode
Walk a bookstore scanning continuously. Each scan answers offline, from local SQLite, in <150ms, with one of four verdicts: **You own this!** (copies, edition scanned vs. owned, shelf location) · **Found one!** (it's on your wishlist) · **You've read this** (read before, not on your shelves) · **A new find!** (one-tap Add to Library / Add to Wishlist). Cross-edition duplicate warning when the ISBN differs but the work matches.

## Register / mode (Impeccable)
Operate. Reliability, scanability, native affordances first; the brand lives in precise details (Store Mode verdict, library card, shelf props). Platform: adaptive (React Native — iOS + Android).

## Voice
Warm librarian, plain verbs, sentence case. Books "live on" shelves; loaned books are "visiting" friends. Never clinical, never twee. Errors name the problem and the fix.

## Non-goals (v1)
Social features, e-books/reading content, AI recommendations, family shared libraries (schema-ready, not built), price tracking.

## Business shape
Freemium: free to ~150 books, one-time unlock (~$9.99). Book people distrust subscriptions.
