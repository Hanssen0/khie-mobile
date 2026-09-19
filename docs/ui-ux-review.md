# Khie Wallet UI/UX review: everyday use vs. developer detail

## Summary

Khie Wallet shows protocol-level detail to every user, and the place where this costs the most is transaction approval. The approval screen lists cells and scripts but never states who gets paid or how much CKB leaves the wallet. This memo recommends one `Developer mode` switch combined with progressive disclosure, instead of two separate interfaces. It lists seven changes in priority order. All seven are implemented on a reference branch, so each one can be reviewed, taken, or dropped on its own.

- First: open every signing request with a plain summary of recipient, amount, balance change, and fee.
- Second: move RPC, relay, peer, key, and build details behind `Developer mode`, off by default.
- Third: keep the navigation bar at three fixed destinations and make the Cryptape Trust device page a sub-page.

## Scope

The review covers onboarding, Account, Send, Receive, the Khie tab (pairing and request approval), the Cryptape Trust device page, and Settings. The review was done against upstream `dev` at `bc3d3c9`, just after v0.7.0. The reference branch has since been merged with `dev` at `3dffa08`.

Two references were used. Material Design 3 applies directly, because the app is Android-first and built on React Native Paper. Apple's Human Interface Guidelines were used only for their platform-neutral parts: the design principles, writing, accessibility, and layout. iOS-specific conventions were not applied.

## Core recommendation: one switch, not two interfaces

Khie has two audiences. Developers testing a dapp want the relay address, the Peer ID, and the raw cells. Someone who only holds CKB wants to know what they are about to sign. Most screens are identical for both groups, and the difference is a small set of fields. Two UI trees would double the work on every screen and in all four locales. A single persisted switch does the job, in the same spirit as Android's own Developer options.

The switch sits at the bottom of Settings, inside App information, and is off by default. It is visible, not hidden behind a gesture, because many current users are developers.

| Item | Everyday | Developer mode |
| --- | --- | --- |
| Network RPC URLs | Hidden | Shown |
| Relay multiaddr (Khie advanced settings) | Hidden | Shown |
| Pairing endpoint under the QR code | `Copy pairing code` button | Full string, tap to copy |
| Connection path chip, agent version, Peer ID | Hidden | Shown |
| Peer name and last seen | Shown | Shown |
| Derivation path and public key | Hidden | Shown |
| Private-key export | Hidden | Shown |
| Recovery-phrase export | Shown | Shown |
| Build commit, architecture, last checked, APK filename | Hidden | Shown |
| Transaction technical details | Collapsed | Expanded by default |

Recovery-phrase export stays visible to everyone because every user needs a backup path.

## Findings and proposals

### 1. Transaction approval does not say what is being approved

Priority: highest. This is a safety issue before it is a design issue.

For a Khie `sign_transaction` request and for the in-app Send review, `src/khie/TransactionApprovalDetails.tsx` shows the transaction hash first, then the fee and fee rate, then every input and output cell with capacity, lock address, and expandable scripts. Nothing states who receives CKB or how much leaves the wallet. To find out, a person has to subtract change outputs from inputs in their head. Most people will tap `Allow` without doing so. Apple's Responsibility principle asks apps to "Be fully transparent about what your product does and why." Its Layout guidance adds: "Take advantage of progressive disclosure to help people discover content that’s currently hidden."

Proposal: open with a summary computed from the transaction. Show each recipient that is not the wallet itself with its CKB amount, then the wallet's net balance change, then the fee. The net change is own outputs minus own inputs, counting Nervos DAO compensation on inputs. The wallet's own locks come from `signer.getAddressObjs()`. Move the hash, fee rate, and cell lists into a collapsible `Technical details` section that opens automatically in developer mode. If any input or output carries a type script, show a notice that the amounts above do not describe tokens or contract data.

Limit: the summary covers CKB capacity only. It does not interpret xUDT amounts, Spore, or DAO deposit and withdrawal semantics. Recognizing common type scripts is the natural next step.

Status: implemented. `src/khie/transactionSummary.ts` is a pure function with three unit tests. `TransactionApprovalDetails` takes an optional `signer` prop. One inconsistency was fixed in passing: input labels used a 0-based index when a cell resolved and a 1-based index when it failed.

### 2. Developer-level detail sits on everyday screens

Priority: high.

The Khie tab has an `Advanced settings` expander with a relay multiaddr field, prints the raw pairing endpoint under the QR code, and after pairing shows a `Direct` / `Relayed` / `Inactive` chip, the remote agent version, and the libp2p Peer ID. Settings has a `Network RPC` card with two URL fields, an `Account information` card with derivation path and public key, private-key export in the same action row as recovery-phrase export, and an `App information` card with build commit, architecture, last-checked time, and APK filename. None of this helps someone who wants to hold and send CKB. Apple's Writing guidance says to "Choose simple, plain language and write with accessibility and localization in mind, avoiding jargon and gendered terminology." Its Simplicity principle reads: "Include just what’s necessary. Simplicity isn’t minimalism. Aim for a focused, useful experience that keeps the important things close by and lets the others fall away."

Upstream `dev` has since added an `Advanced settings` heading above the Network RPC card, which points the same way. The heading still leaves those fields on screen for everyone.

Proposal: gate these items as in the table above. On the branch, the `Advanced settings` heading appears only in developer mode.

Status: implemented. `src/ui/developerMode.tsx` is a small React context stored in SecureStore under `khie.developer-mode.v1`. It is read in `SettingsScreen.tsx`, `KhieScreen.tsx`, and `TransactionApprovalDetails.tsx`.

### 3. The Cryptape Trust tab appears and disappears

Priority: medium-high.

`BottomBar` in `src/ui/navigation.tsx` adds a fourth destination, `Cryptape Trust`, only while a Trust wallet is selected. Switching wallets changes the navigation bar. Material's navigation bar overview is explicit: "Destinations don't change. They should be consistent across app screens." Apple says the same about tab bars: "Don’t disable or hide tab bar buttons, even when their content is unavailable. Having tab bar buttons available in some cases but not others makes your app’s interface appear unstable and unpredictable." Device management is also a task on one wallet, which makes it a poor fit for a top-level destination.

Proposal: make the device page a stack screen with a back button, opened from a `Manage device` button on the Account screen. The bar keeps three fixed destinations, which is also Material's minimum for a navigation bar. After a Trust wallet is added, the app lands on Account, which already offers `Manage device` when the device holds no key.

Status: implemented in `WalletRouter.tsx`, `navigation.tsx`, `TrustDeviceScreen.tsx`, and `AccountScreens.tsx`. The two icon-source helpers that only the tab used were removed from `src/components/CryptapeIcon.tsx`.

### 4. One concept, several names

Priority: medium.

- The English UI says `Mnemonic`, while the authentication prompts and the delete dialog say `recovery phrase`. Proposal: `Recovery phrase` throughout the English UI. Chinese keeps 助记词, which is the standard term.
- The pairing field is labeled `Khie endpoint`, its placeholder says `Or paste pairing code`, and the copy action says `Copy Khie endpoint`. Proposal: one name, `Pairing code`.
- `Change master password` sits next to `Wallet password` and `Current wallet password`. Proposal: `wallet password` everywhere, in all locales.
- The Settings title is `Settings and export`. Proposal: `Settings`.
- One Trust error message points people to the device tab. With finding 3 it becomes the device page, which the Chinese text already says.

Apple's Writing guidance asks to "Give clear guidance and use consistent language throughout processes with multiple steps."

Status: implemented in `src/i18n/index.tsx`. New keys have English, Simplified Chinese, and Traditional Chinese text. Hakka inherits Traditional Chinese through the existing `...zhHant` spread, with a few overrides. The Hakka wording needs a native speaker's review.

### 5. Switch rows and small targets

Priority: medium, accessibility.

The biometric-unlock rows (Settings and onboarding) and the automatic-update row are `List.Item`s that contain a `Switch` with `pointerEvents="none"`. TalkBack announces a button with no on or off state. The address and pairing-code copy rows have `minHeight: 40`. Android's accessibility guidance says: "Consider making touch targets at least 48x48dp, separated by 8dp of space or more, to ensure balanced information density and usability."

Status: implemented. The rows set `accessibilityRole="switch"` and `accessibilityState={{ checked, disabled }}`. The copy rows are 48dp tall.

### 6. The Account screen spends its space on the full address

Priority: low-medium.

The Account screen prints the full address, roughly 100 characters, in monospace across four lines inside a card. People copy an address. They do not read it.

Proposal: one line, middle-ellipsized, tap to copy. The full address and QR code remain on Receive. A further step, not implemented: place `Receive` and `Send` directly under the balance as the screen's primary actions, outside the address card.

Status: the address change is implemented in `AccountScreens.tsx`.

### 7. The Khie explainer never goes away

Priority: low.

The Khie tab always opens with a five-line explanation of the protocol and the etymology of the name, including after pairing, when the space is needed for requests. A section heading also repeats the label of the button directly under it, `Scan connector code`.

Status: implemented. The explainer shows only before pairing. The duplicate heading is removed.

## Further suggestions, not implemented

Settings as a list. Settings is a vertical stack of eight elevated cards, each with an icon and a title. Material does not forbid this, but its card guidance says to "Use a card to display content and actions on a single topic" and suggests, for compact screens, swapping cards for lists. Grouped list sections with subheaders (General, Security, Wallets, About) would be shorter and easier to scan. This was left out of the branch to keep the diff small while upstream moves quickly.

Recovery phrase words as chips. The backup screen renders the words as `Chip` components. Material describes chips as interactive: "Chips help people enter information, make selections, filter content, or trigger actions." The words are static. A numbered two-column grid reads better and is easier to copy by hand. This is a judgment call, since Material has no explicit rule against static chips.

The `Khie` tab label. It names the protocol. A first-time user cannot tell what the tab does. `Connect` with the Khie icon would say more. This is a brand decision.

Send confirmation. After sending, a blocking dialog shows the raw transaction hash. Material's dialog guidance says: "Don't use dialogs for low- or medium-priority information. Instead use a snackbar, which can be dismissed or disappear automatically." Apple agrees: "Avoid using an alert merely to provide information." A `Transaction sent` snackbar with a `View` action that opens a block explorer would fit better.

Wallet deletion. Each wallet row in Settings has a delete icon next to the area that selects the wallet. The confirmation dialog prevents accidents, but a routine action and a destructive one sit side by side. Delete could move into a wallet detail page or an overflow menu.

Refresh. Pull-to-refresh on the Account screen would match platform habit, in addition to or instead of the refresh icon.

Onboarding. `Connect Cryptape Trust` is already a low-emphasis link on the first screen. Since the device is experimental and meant for testnet, it could move one level deeper.

## Reference implementation

- Branch: https://github.com/kydchen/khie-mobile/tree/ui/everyday-vs-developer
- Compare: https://github.com/Hanssen0/khie-mobile/compare/dev...kydchen:khie-mobile:ui/everyday-vs-developer
- Size against current `dev`: 16 files, 380 lines added and 124 removed, not counting this document. This includes the new files and the workflow below.

Verified: `pnpm typecheck` passes. `pnpm test` passes with 22 files and 95 tests, including the three new ones. A release-mode arm64 APK built successfully from the branch before it was merged with the latest `dev`.

Not yet verified: on-device layout across screen sizes and large font scales, TalkBack behavior on a real device, and the Hakka copy.

The branch also adds `.github/workflows/test-apk.yml`, which builds a standalone arm64 APK on pushes to `ui/**` branches. It signs with a throwaway key generated per run, so the APK cannot update an installed release build. It exists for fork testing and can be dropped from any upstream pull request.

## Open questions for the maintainer

1. Is the developer-mode line drawn in the right place for Khie's current audience?
2. The default network is testnet. Everyday users usually expect mainnet, but given the app's safety notice the testnet default may be deliberate. Which should it be?
3. Keep `Khie` as the tab label, or switch to `Connect`?
4. Should the approval summary learn common type scripts next, starting with xUDT amounts and DAO deposit and withdrawal?

## References

Material Design 3 and Android, retrieved September 2026:

- Navigation bar, overview and guidelines: https://m3.material.io/components/navigation-bar/overview and https://m3.material.io/components/navigation-bar/guidelines
- Cards, guidelines: https://m3.material.io/components/cards/guidelines
- Chips, guidelines: https://m3.material.io/components/chips/guidelines
- Dialogs, guidelines: https://m3.material.io/components/dialogs/guidelines
- Android Accessibility Help, touch target size: https://support.google.com/accessibility/android/answer/7101858

Apple Human Interface Guidelines:

- Design principles (Responsibility, Simplicity): https://developer.apple.com/design/human-interface-guidelines/design-principles
- Layout (Visual hierarchy): https://developer.apple.com/design/human-interface-guidelines/layout
- Writing (Getting started, Best practices): https://developer.apple.com/design/human-interface-guidelines/writing
- Tab bars (Best practices): https://developer.apple.com/design/human-interface-guidelines/tab-bars
- Alerts (Best practices): https://developer.apple.com/design/human-interface-guidelines/alerts
