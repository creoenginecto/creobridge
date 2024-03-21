# EVM-Solana Bridge

## Getting Started

### Using a Docker container (recommended)

Build a Docker container:

```
rm id.json || docker build . -t solana-bridge
```

Run an interactive shell in the newly built container:

```
docker run -it solana-bridge
```

You are then able to use the Anchor/Solana CLI tools.

```
anchor test --provider.wallet id.json
```

### Manually

Recommended Node version is `16.20.0`.
Recommended solana-cli version is `1.14.13`.
Recommended yarn version is `1.22.19`.

Follow the [Anchor installation guide](https://www.anchor-lang.com/docs/installation) to learn how to install all the dependencies.

Make sure the dependencies version match those described above and in the Project Structure section.

```bash
$ yarn
$ anchor build
$ anchor test
```

## Project Structure

This a default Anchor Solana project.
Anchor version is `0.27.0`.
Rustc version is `1.67.1`.

### Tests

Tests are found in the `./tests/` folder.

To run tests in the Docker container, do

```bash
$ anchor test --provider.wallet id.json
```

To run tests in a manual setup, do

```bash
$ anchor test
```

### Programs

Solana programs are found in `./programs/`.

### Deploy

The program can be deployed using default methods: anchor deploy OR solana program deploy.

A bridge instance has to be initialized by calling the `initialize` function with appropriate parameters.

## Technical Requirements

The technical requirements are available [here](https://docs.google.com/document/d/1pEEqd8DbL6FH0fBXT86mgBpQboVwzH0l0W_WjMG1FaA/edit?usp=sharing).

## Implementation Details

### Audit scope

The following files contain code that will be deployed on mainnet and thus require a security audit:

- programs/bridge-solana/src/lib.rs

### Architecture

The project is a centralized bridge implementation. End-users of the bridge trust the bridge owner with their funds.

The bridge program, once deployed, can be used to create multiple bridge instances. A bridge instance is identified
by the owner of the instance who is trusted with keeping the funds and relaying correct information between
chains, the mint address of the token used, the current chain identifier -- a 32 byte string, and a version number.
Instances are independent of each other, have different token accounts and privileged accounts.

The following parameters are stored for each instance and can be changed by the instance owner:

- Fee taken on sending token from Solana to another chain
- Fee taken on receiving token on Solana from another chain
- A maximum limit on the amount of token that can be sent in 1 transaction
- Recipient of the fees
- Whether the instance is paused and no longer allows sending or fulfilling bridge transactions
- A list of chains supported by the instance.

The supported chains list is a key-value store, where the key is a 32-byte zero-terminated string-identifier of the supported chain, and value is:

- `enabled`, a boolean value indicating whether interacting with this chain (sending to and fulfilling from) is allowed
- `exchange_rate_from`, an exchange rate allowing to account for differences in decimal points

### Role Model

There is only one privileged wallet in the system, `owner`. A bridge instance initialized with `initialize` is tied to
an owner and **can not be transferred to another wallet**. The owner has the authority to control funds sent to the bridge, change bridge parameters
and is trusted to relay correct information between chains.

Changing the owner is supposed to be done by creating a new bridge instance and transferring bridge funds to it.

If the owner key is stolen or there is otherwise a need to migrate, the owner is supposed to create a new bridge instance, withdraw remaining funds from the
old instance and transfer them to the new instance.

**If the owner key is lost, the bridge will not be able fulfill any transaction, change parameters or pause.**

### Backend

The backend relays bridge transactions sent to a bridge instance to other chains and co-signs `fulfill` transactions
alongside the user, proving their validity.

### Ethereum Contract

The backend relays information from the Ethereum contract to the Solana bridge instance and vice versa, proving its
validity with the trusted keys.

The Ethereum contract stores the following parameters:

- String, current chain ID (e.g. "evm.1" for an Ethereum fork with chain ID 1 i.e. Ethereum itself)
- Token address
- Max send limit
- Last used send nonce

The Ethereum contract has send() and fulfill() functions akin to the Solana program.

#### Send

`send(uint256 amount, string toUser, string toChain)`

The function checks invariants, takes the appropriate amount of token from the caller, writes information about
the transaction to permanent contract storage and increments the global nonce.

The information written is:

- Caller address
- `toUser` -- recipient address on Solana
- Amount
- Current chain ID
- `toChain` -- e.g. "sol.mainnet-beta"
- Current nonce (before incrementing)

Invariants:

- Amount
  - Not zero
  - Less than max send limit
  - Is divisibe by the exchange rate
  - Is more than the fee denominator (10000)
  - Is less than or equal to the user's balance of the token
- To user
  - Is not empty
- To chain
  - Is part of the supported chain list and has an exchange rate set

Note that the nonce isn't unique for the user, it's unique for the entire contract.

#### Fulfill

`fulfill((uint256 amount, string fromUser, address toUser, string fromChain, uint256 nonce), bytes signature)`

The function checks invariants, transfers the appropriate amount of token to the `toUser` address and marks the
transaction as fulfilled preventing double-spend.

Some checks are omitted as the data is supposed to be validated by the Solana program and the backend and proven to be correct by
a signature from a trusted key.

Invariants:

- `fromChain`
  - Is part of the supported chain list and has an exchange rate set
- `nonce`
  - Has not been marked as used for this `fromChain` and `fromUser`
- `signature`
  - Is a valid signature of all the previous arguments from one of the trusted keys

Note that in this case the nonce is unique for `fromChain` and `fromUser`, unlike in Send.

### Usage Scenarios

Below are detailed step-by-step usage scenarios. They may duplicate the ones described in the technical requirement document, but they are written with much more detail, i.e. who calls what function with what parameters, and where do these parameters come from.

#### Scenario 1

1. User calls send(amount, to) ,to - is chainId, and Ethereum BridgeAssist contract transferFrom tokens and store `Transaction` structure.
2. User goes to the frontend (or directly to the backend) and request `Transaction` structure `signature`.
3. With this `signature` and `Transaction` structure user goes to the Solana BridgeAssist contract and is able to
   claim his tokens there
