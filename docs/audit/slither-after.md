Multiple frameworks detected: solc, Solc-json. Using solc (highest priority). Use --compile-force-framework to override.
'solc --version' running
'solc @openzeppelin/=node_modules/@openzeppelin/ contracts/src/AuctionHouse.sol --combined-json abi,ast,bin,bin-runtime,srcmap,srcmap-runtime,userdoc,devdoc,hashes --allow-paths .,C:\Users\prpaw\Downloads\decentralised_auction\contracts\src' running
**THIS CHECKLIST IS NOT COMPLETE**. Use `--show-ignored-findings` to show all the results.
Summary
 - [missing-zero-check](#missing-zero-check) (3 results) (Low)
 - [timestamp](#timestamp) (7 results) (Low)
 - [assembly](#assembly) (9 results) (Informational)
 - [pragma](#pragma) (1 results) (Informational)
 - [dead-code](#dead-code) (2 results) (Informational)
 - [solc-version](#solc-version) (4 results) (Informational)
 - [low-level-calls](#low-level-calls) (1 results) (Informational)
 - [unindexed-event-address](#unindexed-event-address) (2 results) (Informational)
## missing-zero-check
Impact: Low
Confidence: Medium
 - [ ] ID-0
[AuctionHouse.constructor(address,address,uint16).initialFeeRecipient](.contracts/src/AuctionHouse.sol#L337) lacks a zero-check on :
		- [feeRecipient = initialFeeRecipient](.contracts/src/AuctionHouse.sol#L340)

.contracts/src/AuctionHouse.sol#L337


 - [ ] ID-1
[AuctionHouse.setFeeRecipient(address).recipient](.contracts/src/AuctionHouse.sol#L604) lacks a zero-check on :
		- [feeRecipient = recipient](.contracts/src/AuctionHouse.sol#L606)

.contracts/src/AuctionHouse.sol#L604


 - [ ] ID-2
[Ownable2Step.transferOwnership(address).newOwner](.node_modules/@openzeppelin/contracts/access/Ownable2Step.sol#L43) lacks a zero-check on :
		- [_pendingOwner = newOwner](.node_modules/@openzeppelin/contracts/access/Ownable2Step.sol#L44)

.node_modules/@openzeppelin/contracts/access/Ownable2Step.sol#L43


## timestamp
Impact: Low
Confidence: Medium
 - [ ] ID-3
[AuctionHouse.isSettleable(uint256)](.contracts/src/AuctionHouse.sol#L702-L706) uses timestamp for comparisons
	Dangerous comparisons:
	- [auctionId >= _auctions.length](.contracts/src/AuctionHouse.sol#L703)
	- [auction.status == Status.Live && block.timestamp >= auction.endTime](.contracts/src/AuctionHouse.sol#L705)

.contracts/src/AuctionHouse.sol#L702-L706


 - [ ] ID-4
[AuctionHouse.settle(uint256)](.contracts/src/AuctionHouse.sol#L514-L522) uses timestamp for comparisons
	Dangerous comparisons:
	- [block.timestamp < auction.endTime](.contracts/src/AuctionHouse.sol#L518)

.contracts/src/AuctionHouse.sol#L514-L522


 - [ ] ID-5
[AuctionHouse.getAuctions(uint256,uint256)](.contracts/src/AuctionHouse.sol#L632-L644) uses timestamp for comparisons
	Dangerous comparisons:
	- [offset >= total](.contracts/src/AuctionHouse.sol#L634)
	- [i < size](.contracts/src/AuctionHouse.sol#L641)
	- [limit < available](.contracts/src/AuctionHouse.sol#L638)

.contracts/src/AuctionHouse.sol#L632-L644


 - [ ] ID-6
[AuctionHouse.buyNow(uint256)](.contracts/src/AuctionHouse.sol#L470-L503) uses timestamp for comparisons
	Dangerous comparisons:
	- [block.timestamp >= auction.endTime](.contracts/src/AuctionHouse.sol#L474)

.contracts/src/AuctionHouse.sol#L470-L503


 - [ ] ID-7
[AuctionHouse.bid(uint256)](.contracts/src/AuctionHouse.sol#L417-L461) uses timestamp for comparisons
	Dangerous comparisons:
	- [block.timestamp >= auction.endTime](.contracts/src/AuctionHouse.sol#L422)
	- [endTime - uint64(block.timestamp) <= ANTI_SNIPE_WINDOW && auction.extensionCount < MAX_EXTENSIONS](.contracts/src/AuctionHouse.sol#L449)

.contracts/src/AuctionHouse.sol#L417-L461


 - [ ] ID-8
[AuctionHouse.timeRemaining(uint256)](.contracts/src/AuctionHouse.sol#L670-L675) uses timestamp for comparisons
	Dangerous comparisons:
	- [block.timestamp >= auction.endTime](.contracts/src/AuctionHouse.sol#L673)

.contracts/src/AuctionHouse.sol#L670-L675


 - [ ] ID-9
[AuctionHouse._auctionAt(uint256)](.contracts/src/AuctionHouse.sol#L830-L833) uses timestamp for comparisons
	Dangerous comparisons:
	- [auctionId >= _auctions.length](.contracts/src/AuctionHouse.sol#L831)

.contracts/src/AuctionHouse.sol#L830-L833


## assembly
Impact: Informational
Confidence: High
 - [ ] ID-10
[StorageSlot.getAddressSlot(bytes32)](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L66-L70) uses assembly
	- [INLINE ASM](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L67-L69)

.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L66-L70


 - [ ] ID-11
[StorageSlot.getUint256Slot(bytes32)](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L93-L97) uses assembly
	- [INLINE ASM](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L94-L96)

.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L93-L97


 - [ ] ID-12
[StorageSlot.getBooleanSlot(bytes32)](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L75-L79) uses assembly
	- [INLINE ASM](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L76-L78)

.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L75-L79


 - [ ] ID-13
[StorageSlot.getBytes32Slot(bytes32)](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L84-L88) uses assembly
	- [INLINE ASM](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L85-L87)

.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L84-L88


 - [ ] ID-14
[StorageSlot.getInt256Slot(bytes32)](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L102-L106) uses assembly
	- [INLINE ASM](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L103-L105)

.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L102-L106


 - [ ] ID-15
[StorageSlot.getBytesSlot(bytes)](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L138-L142) uses assembly
	- [INLINE ASM](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L139-L141)

.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L138-L142


 - [ ] ID-16
[StorageSlot.getStringSlot(bytes32)](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L111-L115) uses assembly
	- [INLINE ASM](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L112-L114)

.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L111-L115


 - [ ] ID-17
[StorageSlot.getStringSlot(string)](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L120-L124) uses assembly
	- [INLINE ASM](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L121-L123)

.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L120-L124


 - [ ] ID-18
[StorageSlot.getBytesSlot(bytes32)](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L129-L133) uses assembly
	- [INLINE ASM](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L130-L132)

.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L129-L133


## pragma
Impact: Informational
Confidence: High
 - [ ] ID-19
5 different versions of Solidity are used:
	- Version constraint 0.8.36 is used by:
		-[0.8.36](.contracts/src/AuctionHouse.sol#L2)
	- Version constraint ^0.8.20 is used by:
		-[^0.8.20](.node_modules/@openzeppelin/contracts/access/Ownable.sol#L4)
		-[^0.8.20](.node_modules/@openzeppelin/contracts/access/Ownable2Step.sol#L4)
		-[^0.8.20](.node_modules/@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol#L4)
		-[^0.8.20](.node_modules/@openzeppelin/contracts/utils/Context.sol#L4)
		-[^0.8.20](.node_modules/@openzeppelin/contracts/utils/Pausable.sol#L4)
		-[^0.8.20](.node_modules/@openzeppelin/contracts/utils/ReentrancyGuard.sol#L4)
		-[^0.8.20](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L5)
	- Version constraint >=0.6.2 is used by:
		-[>=0.6.2](.node_modules/@openzeppelin/contracts/token/ERC721/IERC721.sol#L4)
	- Version constraint >=0.5.0 is used by:
		-[>=0.5.0](.node_modules/@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol#L4)
	- Version constraint >=0.4.16 is used by:
		-[>=0.4.16](.node_modules/@openzeppelin/contracts/utils/introspection/IERC165.sol#L4)

.contracts/src/AuctionHouse.sol#L2


## dead-code
Impact: Informational
Confidence: Medium
 - [ ] ID-20
[Context._contextSuffixLength()](.node_modules/@openzeppelin/contracts/utils/Context.sol#L25-L27) is never used and should be removed

.node_modules/@openzeppelin/contracts/utils/Context.sol#L25-L27


 - [ ] ID-21
[Context._msgData()](.node_modules/@openzeppelin/contracts/utils/Context.sol#L21-L23) is never used and should be removed

.node_modules/@openzeppelin/contracts/utils/Context.sol#L21-L23


## solc-version
Impact: Informational
Confidence: High
 - [ ] ID-22
Version constraint >=0.5.0 contains known severe issues (https://solidity.readthedocs.io/en/latest/bugs.html)
	- DirtyBytesArrayToStorage
	- ABIDecodeTwoDimensionalArrayMemory
	- KeccakCaching
	- EmptyByteArrayCopy
	- DynamicArrayCleanup
	- ImplicitConstructorCallvalueCheck
	- TupleAssignmentMultiStackSlotComponents
	- MemoryArrayCreationOverflow
	- privateCanBeOverridden
	- SignedArrayStorageCopy
	- ABIEncoderV2StorageArrayWithMultiSlotElement
	- DynamicConstructorArgumentsClippedABIV2
	- UninitializedFunctionPointerInConstructor
	- IncorrectEventSignatureInLibraries
	- ABIEncoderV2PackedStorage.
It is used by:
	- [>=0.5.0](.node_modules/@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol#L4)

.node_modules/@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol#L4


 - [ ] ID-23
Version constraint ^0.8.20 contains known severe issues (https://solidity.readthedocs.io/en/latest/bugs.html)
	- VerbatimInvalidDeduplication
	- FullInlinerNonExpressionSplitArgumentEvaluationOrder
	- MissingSideEffectsOnSelectorAccess.
It is used by:
	- [^0.8.20](.node_modules/@openzeppelin/contracts/access/Ownable.sol#L4)
	- [^0.8.20](.node_modules/@openzeppelin/contracts/access/Ownable2Step.sol#L4)
	- [^0.8.20](.node_modules/@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol#L4)
	- [^0.8.20](.node_modules/@openzeppelin/contracts/utils/Context.sol#L4)
	- [^0.8.20](.node_modules/@openzeppelin/contracts/utils/Pausable.sol#L4)
	- [^0.8.20](.node_modules/@openzeppelin/contracts/utils/ReentrancyGuard.sol#L4)
	- [^0.8.20](.node_modules/@openzeppelin/contracts/utils/StorageSlot.sol#L5)

.node_modules/@openzeppelin/contracts/access/Ownable.sol#L4


 - [ ] ID-24
Version constraint >=0.6.2 contains known severe issues (https://solidity.readthedocs.io/en/latest/bugs.html)
	- MissingSideEffectsOnSelectorAccess
	- AbiReencodingHeadOverflowWithStaticArrayCleanup
	- DirtyBytesArrayToStorage
	- NestedCalldataArrayAbiReencodingSizeValidation
	- ABIDecodeTwoDimensionalArrayMemory
	- KeccakCaching
	- EmptyByteArrayCopy
	- DynamicArrayCleanup
	- MissingEscapingInFormatting
	- ArraySliceDynamicallyEncodedBaseType
	- ImplicitConstructorCallvalueCheck
	- TupleAssignmentMultiStackSlotComponents
	- MemoryArrayCreationOverflow.
It is used by:
	- [>=0.6.2](.node_modules/@openzeppelin/contracts/token/ERC721/IERC721.sol#L4)

.node_modules/@openzeppelin/contracts/token/ERC721/IERC721.sol#L4


 - [ ] ID-25
Version constraint >=0.4.16 contains known severe issues (https://solidity.readthedocs.io/en/latest/bugs.html)
	- DirtyBytesArrayToStorage
	- ABIDecodeTwoDimensionalArrayMemory
	- KeccakCaching
	- EmptyByteArrayCopy
	- DynamicArrayCleanup
	- ImplicitConstructorCallvalueCheck
	- TupleAssignmentMultiStackSlotComponents
	- MemoryArrayCreationOverflow
	- privateCanBeOverridden
	- SignedArrayStorageCopy
	- ABIEncoderV2StorageArrayWithMultiSlotElement
	- DynamicConstructorArgumentsClippedABIV2
	- UninitializedFunctionPointerInConstructor_0.4.x
	- IncorrectEventSignatureInLibraries_0.4.x
	- ExpExponentCleanup
	- NestedArrayFunctionCallDecoder
	- ZeroFunctionSelector.
It is used by:
	- [>=0.4.16](.node_modules/@openzeppelin/contracts/utils/introspection/IERC165.sol#L4)

.node_modules/@openzeppelin/contracts/utils/introspection/IERC165.sol#L4


## low-level-calls
Impact: Informational
Confidence: High
 - [ ] ID-26
Low level call in [AuctionHouse.withdraw()](.contracts/src/AuctionHouse.sol#L554-L565):
	- [(ok,None) = address(msg.sender).call{value: amount}()](.contracts/src/AuctionHouse.sol#L561)

.contracts/src/AuctionHouse.sol#L554-L565


## unindexed-event-address
Impact: Informational
Confidence: High
 - [ ] ID-27
Event [Pausable.Unpaused(address)](.node_modules/@openzeppelin/contracts/utils/Pausable.sol#L28) has address parameters but no indexed parameters

.node_modules/@openzeppelin/contracts/utils/Pausable.sol#L28


 - [ ] ID-28
Event [Pausable.Paused(address)](.node_modules/@openzeppelin/contracts/utils/Pausable.sol#L23) has address parameters but no indexed parameters

.node_modules/@openzeppelin/contracts/utils/Pausable.sol#L23


