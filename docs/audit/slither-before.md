# Slither baseline — the contract this project replaces

Tool: Slither 0.11.6 (Trail of Bits) · solc 0.8.36 · run 2026-08-26
Target: `backend/contracts/DecentralizedAuction.sol` (the ORIGINAL contract)

This report is kept on purpose. It is the "before" measurement.

Slither reported **17 issues** without any human guidance. The most important
is `reentrancy-eth` at **High** impact: `buyout()` makes an external call on
line 98 and then writes `item.highestBidder` and `item.highestBid` on lines 102
and 103. Slither also lists the eight other functions that read the same
`items` array, which is precisely the cross-function reentrancy path the manual
audit found.

The replacement contract lives in `contracts/src/AuctionHouse.sol`. Compare
this report against `slither-after.md` in the same directory.

---

Multiple frameworks detected: solc, Solc-json. Using solc (highest priority). Use --compile-force-framework to override.
'solc --version' running
'solc backend/contracts/DecentralizedAuction.sol --combined-json abi,ast,bin,bin-runtime,srcmap,srcmap-runtime,userdoc,devdoc,hashes --allow-paths .,C:\Users\prpaw\Downloads\decentralised_auction\backend\contracts' running
Compilation warnings/errors on backend/contracts/DecentralizedAuction.sol:
Warning: 'transfer' is deprecated and scheduled for removal. Use 'call{value: <amount>}("")' instead.

   --> backend/contracts/DecentralizedAuction.sol:104:9:

    |

104 |         item.seller.transfer(msg.value);

    |         ^^^^^^^^^^^^^^^^^^^^



Warning: 'transfer' is deprecated and scheduled for removal. Use 'call{value: <amount>}("")' instead.

   --> backend/contracts/DecentralizedAuction.sol:117:9:

    |

117 |         item.seller.transfer(item.highestBid);

    |         ^^^^^^^^^^^^^^^^^^^^




**THIS CHECKLIST IS NOT COMPLETE**. Use `--show-ignored-findings` to show all the results.
Summary
 - [reentrancy-eth](#reentrancy-eth) (2 results) (High)
 - [reentrancy-events](#reentrancy-events) (2 results) (Low)
 - [solc-version](#solc-version) (1 results) (Informational)
 - [low-level-calls](#low-level-calls) (2 results) (Informational)
 - [naming-convention](#naming-convention) (2 results) (Informational)
 - [reentrancy-unlimited-gas](#reentrancy-unlimited-gas) (2 results) (Informational)
 - [unindexed-event-address](#unindexed-event-address) (4 results) (Informational)
 - [cache-array-length](#cache-array-length) (2 results) (Optimization)
## reentrancy-eth
Impact: High
Confidence: Medium
 - [ ] ID-0
Reentrancy in [DecentralizedAuction.buyout(uint256)](.backend/contracts/DecentralizedAuction.sol#L89-L107):
	External calls:
	- [(success,None) = item.highestBidder.call{value: item.highestBid}()](.backend/contracts/DecentralizedAuction.sol#L98)
	State variables written after the call(s):
	- [item.highestBidder = msg.sender](.backend/contracts/DecentralizedAuction.sol#L102)
	[DecentralizedAuction.items](.backend/contracts/DecentralizedAuction.sol#L23) can be used in cross function reentrancies:
	- [DecentralizedAuction.addItem(string,string,uint256,uint256)](.backend/contracts/DecentralizedAuction.sol#L48-L64)
	- [DecentralizedAuction.bid(uint256)](.backend/contracts/DecentralizedAuction.sol#L66-L86)
	- [DecentralizedAuction.buyout(uint256)](.backend/contracts/DecentralizedAuction.sol#L89-L107)
	- [DecentralizedAuction.endAuction(uint256)](.backend/contracts/DecentralizedAuction.sol#L110-L120)
	- [DecentralizedAuction.getAllUserItems()](.backend/contracts/DecentralizedAuction.sol#L139-L162)
	- [DecentralizedAuction.items](.backend/contracts/DecentralizedAuction.sol#L23)
	- [DecentralizedAuction.itemsCount()](.backend/contracts/DecentralizedAuction.sol#L134-L136)
	- [DecentralizedAuction.manualEndAuction(uint256)](.backend/contracts/DecentralizedAuction.sol#L124-L131)
	- [item.highestBid = msg.value](.backend/contracts/DecentralizedAuction.sol#L103)
	[DecentralizedAuction.items](.backend/contracts/DecentralizedAuction.sol#L23) can be used in cross function reentrancies:
	- [DecentralizedAuction.addItem(string,string,uint256,uint256)](.backend/contracts/DecentralizedAuction.sol#L48-L64)
	- [DecentralizedAuction.bid(uint256)](.backend/contracts/DecentralizedAuction.sol#L66-L86)
	- [DecentralizedAuction.buyout(uint256)](.backend/contracts/DecentralizedAuction.sol#L89-L107)
	- [DecentralizedAuction.endAuction(uint256)](.backend/contracts/DecentralizedAuction.sol#L110-L120)
	- [DecentralizedAuction.getAllUserItems()](.backend/contracts/DecentralizedAuction.sol#L139-L162)
	- [DecentralizedAuction.items](.backend/contracts/DecentralizedAuction.sol#L23)
	- [DecentralizedAuction.itemsCount()](.backend/contracts/DecentralizedAuction.sol#L134-L136)
	- [DecentralizedAuction.manualEndAuction(uint256)](.backend/contracts/DecentralizedAuction.sol#L124-L131)

.backend/contracts/DecentralizedAuction.sol#L89-L107


 - [ ] ID-1
Reentrancy in [DecentralizedAuction.bid(uint256)](.backend/contracts/DecentralizedAuction.sol#L66-L86):
	External calls:
	- [(success,None) = item.highestBidder.call{value: item.highestBid}()](.backend/contracts/DecentralizedAuction.sol#L77)
	State variables written after the call(s):
	- [item.highestBidder = address(msg.sender)](.backend/contracts/DecentralizedAuction.sol#L82)
	[DecentralizedAuction.items](.backend/contracts/DecentralizedAuction.sol#L23) can be used in cross function reentrancies:
	- [DecentralizedAuction.addItem(string,string,uint256,uint256)](.backend/contracts/DecentralizedAuction.sol#L48-L64)
	- [DecentralizedAuction.bid(uint256)](.backend/contracts/DecentralizedAuction.sol#L66-L86)
	- [DecentralizedAuction.buyout(uint256)](.backend/contracts/DecentralizedAuction.sol#L89-L107)
	- [DecentralizedAuction.endAuction(uint256)](.backend/contracts/DecentralizedAuction.sol#L110-L120)
	- [DecentralizedAuction.getAllUserItems()](.backend/contracts/DecentralizedAuction.sol#L139-L162)
	- [DecentralizedAuction.items](.backend/contracts/DecentralizedAuction.sol#L23)
	- [DecentralizedAuction.itemsCount()](.backend/contracts/DecentralizedAuction.sol#L134-L136)
	- [DecentralizedAuction.manualEndAuction(uint256)](.backend/contracts/DecentralizedAuction.sol#L124-L131)
	- [item.highestBid = msg.value](.backend/contracts/DecentralizedAuction.sol#L83)
	[DecentralizedAuction.items](.backend/contracts/DecentralizedAuction.sol#L23) can be used in cross function reentrancies:
	- [DecentralizedAuction.addItem(string,string,uint256,uint256)](.backend/contracts/DecentralizedAuction.sol#L48-L64)
	- [DecentralizedAuction.bid(uint256)](.backend/contracts/DecentralizedAuction.sol#L66-L86)
	- [DecentralizedAuction.buyout(uint256)](.backend/contracts/DecentralizedAuction.sol#L89-L107)
	- [DecentralizedAuction.endAuction(uint256)](.backend/contracts/DecentralizedAuction.sol#L110-L120)
	- [DecentralizedAuction.getAllUserItems()](.backend/contracts/DecentralizedAuction.sol#L139-L162)
	- [DecentralizedAuction.items](.backend/contracts/DecentralizedAuction.sol#L23)
	- [DecentralizedAuction.itemsCount()](.backend/contracts/DecentralizedAuction.sol#L134-L136)
	- [DecentralizedAuction.manualEndAuction(uint256)](.backend/contracts/DecentralizedAuction.sol#L124-L131)

.backend/contracts/DecentralizedAuction.sol#L66-L86


## reentrancy-events
Impact: Low
Confidence: Medium
 - [ ] ID-2
Reentrancy in [DecentralizedAuction.bid(uint256)](.backend/contracts/DecentralizedAuction.sol#L66-L86):
	External calls:
	- [(success,None) = item.highestBidder.call{value: item.highestBid}()](.backend/contracts/DecentralizedAuction.sol#L77)
	Event emitted after the call(s):
	- [HighestBidIncreased(itemId,msg.sender,msg.value)](.backend/contracts/DecentralizedAuction.sol#L85)

.backend/contracts/DecentralizedAuction.sol#L66-L86


 - [ ] ID-3
Reentrancy in [DecentralizedAuction.buyout(uint256)](.backend/contracts/DecentralizedAuction.sol#L89-L107):
	External calls:
	- [(success,None) = item.highestBidder.call{value: item.highestBid}()](.backend/contracts/DecentralizedAuction.sol#L98)
	External calls sending eth:
	- [(success,None) = item.highestBidder.call{value: item.highestBid}()](.backend/contracts/DecentralizedAuction.sol#L98)
	- [item.seller.transfer(msg.value)](.backend/contracts/DecentralizedAuction.sol#L104)
	Event emitted after the call(s):
	- [ItemBoughtOut(itemId,msg.sender,msg.value)](.backend/contracts/DecentralizedAuction.sol#L106)

.backend/contracts/DecentralizedAuction.sol#L89-L107


## solc-version
Impact: Informational
Confidence: High
 - [ ] ID-4
Version constraint ^0.8.0 contains known severe issues (https://solidity.readthedocs.io/en/latest/bugs.html)
	- FullInlinerNonExpressionSplitArgumentEvaluationOrder
	- MissingSideEffectsOnSelectorAccess
	- AbiReencodingHeadOverflowWithStaticArrayCleanup
	- DirtyBytesArrayToStorage
	- DataLocationChangeInInternalOverride
	- NestedCalldataArrayAbiReencodingSizeValidation
	- SignedImmutables
	- ABIDecodeTwoDimensionalArrayMemory
	- KeccakCaching.
It is used by:
	- [^0.8.0](.backend/contracts/DecentralizedAuction.sol#L2)

.backend/contracts/DecentralizedAuction.sol#L2


## low-level-calls
Impact: Informational
Confidence: High
 - [ ] ID-5
Low level call in [DecentralizedAuction.buyout(uint256)](.backend/contracts/DecentralizedAuction.sol#L89-L107):
	- [(success,None) = item.highestBidder.call{value: item.highestBid}()](.backend/contracts/DecentralizedAuction.sol#L98)

.backend/contracts/DecentralizedAuction.sol#L89-L107


 - [ ] ID-6
Low level call in [DecentralizedAuction.bid(uint256)](.backend/contracts/DecentralizedAuction.sol#L66-L86):
	- [(success,None) = item.highestBidder.call{value: item.highestBid}()](.backend/contracts/DecentralizedAuction.sol#L77)

.backend/contracts/DecentralizedAuction.sol#L66-L86


## naming-convention
Impact: Informational
Confidence: High
 - [ ] ID-7
Parameter [DecentralizedAuction.getUser(address)._userAddress](.backend/contracts/DecentralizedAuction.sol#L43) is not in mixedCase

.backend/contracts/DecentralizedAuction.sol#L43


 - [ ] ID-8
Parameter [DecentralizedAuction.registerUser(string)._username](.backend/contracts/DecentralizedAuction.sol#L36) is not in mixedCase

.backend/contracts/DecentralizedAuction.sol#L36


## reentrancy-unlimited-gas
Impact: Informational
Confidence: Medium
 - [ ] ID-9
Reentrancy in [DecentralizedAuction.buyout(uint256)](.backend/contracts/DecentralizedAuction.sol#L89-L107):
	External calls:
	- [item.seller.transfer(msg.value)](.backend/contracts/DecentralizedAuction.sol#L104)
	External calls sending eth:
	- [(success,None) = item.highestBidder.call{value: item.highestBid}()](.backend/contracts/DecentralizedAuction.sol#L98)
	- [item.seller.transfer(msg.value)](.backend/contracts/DecentralizedAuction.sol#L104)
	Event emitted after the call(s):
	- [ItemBoughtOut(itemId,msg.sender,msg.value)](.backend/contracts/DecentralizedAuction.sol#L106)

.backend/contracts/DecentralizedAuction.sol#L89-L107


 - [ ] ID-10
Reentrancy in [DecentralizedAuction.endAuction(uint256)](.backend/contracts/DecentralizedAuction.sol#L110-L120):
	External calls:
	- [item.seller.transfer(item.highestBid)](.backend/contracts/DecentralizedAuction.sol#L117)
	Event emitted after the call(s):
	- [AuctionEnded(itemId,item.highestBidder,item.highestBid)](.backend/contracts/DecentralizedAuction.sol#L119)

.backend/contracts/DecentralizedAuction.sol#L110-L120


## unindexed-event-address
Impact: Informational
Confidence: High
 - [ ] ID-11
Event [DecentralizedAuction.ItemBoughtOut(uint256,address,uint256)](.backend/contracts/DecentralizedAuction.sol#L32) has address parameters but no indexed parameters

.backend/contracts/DecentralizedAuction.sol#L32


 - [ ] ID-12
Event [DecentralizedAuction.AuctionEnded(uint256,address,uint256)](.backend/contracts/DecentralizedAuction.sol#L31) has address parameters but no indexed parameters

.backend/contracts/DecentralizedAuction.sol#L31


 - [ ] ID-13
Event [DecentralizedAuction.HighestBidIncreased(uint256,address,uint256)](.backend/contracts/DecentralizedAuction.sol#L30) has address parameters but no indexed parameters

.backend/contracts/DecentralizedAuction.sol#L30


 - [ ] ID-14
Event [DecentralizedAuction.UserRegistered(address,string)](.backend/contracts/DecentralizedAuction.sol#L27) has address parameters but no indexed parameters

.backend/contracts/DecentralizedAuction.sol#L27


## cache-array-length
Impact: Optimization
Confidence: High
 - [ ] ID-15
Loop condition [index < items.length](.backend/contracts/DecentralizedAuction.sol#L144) should use cached array length instead of referencing `length` member of the storage array.
 
.backend/contracts/DecentralizedAuction.sol#L144


 - [ ] ID-16
Loop condition [index_scope_0 < items.length](.backend/contracts/DecentralizedAuction.sol#L154) should use cached array length instead of referencing `length` member of the storage array.
 
.backend/contracts/DecentralizedAuction.sol#L154


