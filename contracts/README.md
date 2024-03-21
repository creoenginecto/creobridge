# Bridge Contract

## Getting Started

Recommended Node version is 16.0.0.

```bash
$ yarn
$ yarn compile
$ yarn testf
```

## Project Structure

This a hardhat typescript project with `hardhat-deploy` extension.
Solidity version `0.8.18`

### Tests

Tests are found in the `./test/` folder.

To run tests

```bash
$ yarn testf
```

To run coverage

```bash
$ yarn coverage
```

### Contracts

Solidity smart contracts are found in `./contracts/`.
`./contracts/mock` folder contains contracts mocks that are used for testing purposes.

### Deploy

Deploy script can be found in the `./deploy/localhost` for local testing and `./deploy/mainnet` for mainnet deploy

Generate `.env` file

```bash
$ cp .env.example .env
```

Add .env file to the project root.

To add the private key of a deployer account, assign the following variable

```
PRIVATE_TEST=
PRIVATE_MAIN=
```

To add API Keys for verifying

```
API_ETH=
API_BSC=
API_POLYGON=
API_AVAX=
API_FTM=
API_ARBITRUM=
```

To deploy contracts on `Polygon chain`

You need to pass to constructor parameters:

#### For Bridge Assist

1. `token_` - token supposed to be bridged
2. `limitPerSend_` - limit for one transaction though the bridge
3. `feeWallet_` - address required to received bridge tx fees
4. `feeSend_` - amount of fee taken on sending from the contract, as fractions of 1/10000, e.g. 100 is 1%
5. `feeFulfill_` - amount of fee taken on fulfilling to the contract, as fractions of 1/10000, e.g. 100 is 1%
6. `owner_` - address, who will have writes to set fees amount, fee wallet, limit per send, withdraw any tokens in arbitrary amount, pause/unpause both directions,
7. `relayers_` - an array of relayers who are trusted to relay information between chains. the array should contain no
   duplicates.
8. `relayerConsensusThreshold_` - the amount of relayers that have to approve a transaction for it to be fulfilled

#### For Token

1. `name` - token name string
2. `symbol` - token symbol string
3. `totalSupply_` - token total supply amount in token weis
4. `owner_` - token contract owner

```bash
$ yarn deploy --network polygon_mainnet
```

### Deployments

Deployments on mainnets and testnets store in `./deployments`

### Verify

To verify contracts on `Polygon chain`

```bash
$ yarn verify --network polygon_mainnet
```

### Setup

Setup functions list:

#### For Bridge Assist

1. funciton `setFee`(`feeSend_`, `feeFulfill_`)

   - `feeSend_` - amount of fee taken on sending from the contract, as fractions of 1/10000, e.g. 100 is 1%
   - `feeFulfill_` - amount of fee taken on fulfilling to the contract, as fractions of 1/10000, e.g. 100 is 1%

2. function `setFeeWallet`(`feeWallet_`)

   - `feeWallet_` - is new address to receive fees.

3. `setLimitPerSend`(`limitPerSend_`)

   - `limitPerSend_` - is new value of transfer limit.

4. `addChains`(`chains`, `exchangeRatesFrom`)

   - `chains` - string IDs of chains to allow interacting with from the contract
   - `exchangeRatesFrom` - array where exchangeRatesFrom[i] is the exchange rate the amount has to be multiplied by when
     fulfilled from chains[i] and divided by when sending to chains[i]

5. `setRelayers`(`relayers`, `relayerConsensusThreshold`)

   - `relayers` - an array of relayers who are trusted to relay information between chains. the array should contain no duplicates.
   - `relayerConsensusThreshold` - the amount of relayers that have to approve a transaction for it to be fulfilled

Funds are added to the bridge by transferring them to the contract address.
**If there is not enough funds on the contract receiving funds will be impossible.**
The admins are supposed to keep enough liquidity on the both end of the bridge so that this does not happen.

#### For Token

1. funciton `setLocked`(`user`, `status`)

   - `user` - address of user who is restricted to send or receive tokens
   - `status` - bool, whether to restrict or unrestrict the user

## Test Coverage

```text
  BridgeAssist contract
setuping "Token" ... setuped
setuping "BridgeAssist" ... gas used 239370
setuped
    ✔ constructor requires (210ms)
    ✔ should send tokens (154ms)
    ✔ should fulfill tokens from bridge preventing double-spend (117ms)
    ✔ multiple users test (90ms)
    ✔ should take proper fee on fulfill and prevent double-spend (55ms)
    ✔ should not send with bad token (58ms)
    ✔ should not send over the limit (62ms)
    ✔ should withdraw, pause, set chains, set parameters, set relayers and prevent using incorrect values (330ms)

  BridgeAssist contract
    ✔ constructor requires
    ✔ set locked
    ✔ transfer


  11 passing (2s)

-------------------|----------|----------|----------|----------|----------------|
File               |  % Stmts | % Branch |  % Funcs |  % Lines |Uncovered Lines |
-------------------|----------|----------|----------|----------|----------------|
 contracts/        |      100 |      100 |      100 |      100 |                |
  BridgeAssist.sol |      100 |      100 |      100 |      100 |                |
  CreoEngine.sol   |      100 |      100 |      100 |      100 |                |
 contracts/mock/   |     87.5 |       75 |       75 |     87.5 |                |
  Token.sol        |     87.5 |       75 |       75 |     87.5 |             26 |
-------------------|----------|----------|----------|----------|----------------|
All files          |    99.16 |    98.91 |    96.88 |    99.26 |                |
-------------------|----------|----------|----------|----------|----------------|
```

Contracts in contracts/mock/ will not be deployed to mainnet so they are not tested.

## Technical Requirements

The technical requirements are available [here](https://docs.google.com/document/d/1psKAR46IJzAKiSKOBxybOv1gLM493SsNKmFU-Bhshh8/edit?usp=sharing).

## Implementation Details

### Audit scope

The following files contain code that will be deployed on mainnet and thus require a security audit:

- BridgeAssist.sol
- CreoEngine.sol

### CreoEngine Token

The following token contains the restrict list to prevent concrete users to send or receive tokens

### Architecture

The project is a centralized bridge implementation. End-users of the bridge trust the bridge owner with their funds.

The system consists of an BridgeAssist contract deployed on different chains (unlimited chains amount enabled).
The BridgeAssist has two main functions:

- send - receives tokens from user and stores all necessary transfer information.
- fulfill - allows user to get tokens he transfered on another chain.

Send and Fulfill emit SentTokens() and FulfilledTokens() events. They contain the sender address, the recipient
address, sending chain, receiving chain, amount and exchange rate applied. **NOTE: amount is the amount that gets
transferred to/from the bridge on the current chain, which may be different from the amount the user gets on the receiving chain.**

Addresses that can potentially be non-EVM addresses are stored as strings.

#### Exchange Rate

Exchange rate is a mechanism used to account for different decimals on different chains. Let's say our Solana token has
9 decimals, but our Ethereum token has 18. We can set exchange rate on Ethereum to 10\*\*9. The amount is divided by the
exchange rate during send and multiplied during fulfill, resulting in smooth conversion.

The send function checks that the amount is wholly divisible by the exchange rate to make sure no dust is left in
the contract.

#### Limit per send

Maximum amount provided as argument to send() is limited by the limit per send, changeable by the admin. The admin
should be able to set the limit to any number from 0 to infinity. The limit can be bypassed by sending several
transactions or using multicall, which is not a problem.

### Role Model

The BridgeAssist roles are:

- Relayer: proves information from other chains. Approval from multiple relayers is required for a piece of information
  to be considered truthful.
- Manager: can set fee, feeWallet, limitPerSend, pause/unpause contract and withdraw tokens from contract.
- DefaultAdmin: can grant/revoke Manager and DefaultAdmin roles.

### Backend

The backend stores the wallet private key, and sign with this key transaction information (struct Transaction) from contract on first chain, after that user can call fulfill function with this signature and receive tokens on second chain, if signature and transaction data is valid. The backend wallet address neceserily has realayer role.

### Usage Scenarios

Below are detailed step-by-step usage scenarios. They may duplicate the ones described in the technical requirement document, but they are written with much more detail, i.e. who calls what function with what parameters, and where do these parameters come from.

#### Scenario 1

1. User calls send(amount, to) ,to - is chainId, and Ethereum BridgeAssist contract transferFrom tokens and store `Transaction` structure.
2. User goes to the frontend (or directly to the backend) and request `Transaction` structure `signature` from multiple
   relayers.
3. With the signatures and `Transaction` structure user goes to the Polygon BridgeAssist contract and calls fulfill(`Transaction`, `signature`) function, user gets his corresponding tokens amount.

#### Scenario 2

1. User calls send(amount, to) ,to - is chainId, and Ethereum BridgeAssist contract transferFrom tokens and store `Transaction` structure.
2. User goes to the frontend (or directly to the backend) and request `Transaction` structure `signature` from multiple
   relayers.
3. With the signatures and `Transaction` structure user goes to the Solana BridgeAssist contract and is able to
   claim his tokens there
