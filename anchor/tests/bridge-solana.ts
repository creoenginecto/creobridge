import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BridgeSolana } from "../target/types/bridge_solana";
import * as spl from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import { readFileSync, readdirSync } from "fs";
import { inspect } from "util";

const Error = {
  SendFeeTooHigh: ["SendFeeTooHigh"],
  FulfillFeeTooHigh: ["FulfillFeeTooHigh"],
};

// function hexToBytes(hex: string): number[] {
// for (var bytes = [], c = 0; c < hex.length; c += 2)
//   bytes.push(parseInt(hex.substr(c, 2), 16));
// return bytes;
// }

function ethAddress(ethAddress: string) {
  // return { bytes: hexToBytes(ethAddress.slice(2)).map((x) => new anchor.BN(x)) }
  const paddedAddress = ethAddress.slice(2).padEnd(64, "0");
  const buf = Buffer.from(paddedAddress, "hex");
  const arr = Array.from(buf);
  // console.log('ethAddress', paddedAddress, buf, arr)
  return { byte: arr };
}

function getFileLengths(dir: string, files: string[]): Record<string, number> {
  const lengths: Record<string, number> = {};

  for (const file of files) {
    const fileContents = readFileSync(dir + file, { encoding: "utf8" });
    lengths[file] = fileContents.length;
  }

  return lengths;
}

function folderDiff(
  dir: string,
  files: string[],
  oldLengths: Record<string, number>
): string {
  const newLengths = getFileLengths(dir, files);
  let finalDiff = "";

  for (const file of files) {
    if (newLengths[file] == oldLengths[file]) continue;

    const oldLen = oldLengths[file] || 0;
    const diff = readFileSync(dir + file, { encoding: "utf8" }).slice(oldLen);
    finalDiff += diff + "\n\n";
  }

  return finalDiff;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const LOG_FOLDER = ".anchor/program-logs/";

// we have to read the log file because the errors thrown by
// web3.js are bad and don't have all the logs
async function revertsWithLog(
  func: () => Promise<any>,
  err: string[]
): Promise<boolean> {
  const oldLogFiles = readdirSync(LOG_FOLDER);
  const oldLogsLen = getFileLengths(LOG_FOLDER, oldLogFiles);

  let reverted = false;

  try {
    await func();
  } catch (e: any) {
    reverted = true;
  }

  if (!reverted) return false;

  // wait for the log to update
  // WARNING: if your pc is too weak/func is too big, the delay
  // might be too small, causing `diff` to always be '' (empty string)
  // TODO: wait for a file change event
  await sleep(100);
  const newLogFiles = readdirSync(LOG_FOLDER);
  const diff = folderDiff(LOG_FOLDER, newLogFiles, oldLogsLen);

  const found = err
    .map((x) => diff.search(x) != -1)
    .reduce((a, b) => a && b, true);

  if (!found)
    console.log(
      `revertsWithLog: tx reverted with different error, expected ${err}, got ${diff}`
    );

  return reverted && found;
}

async function revertsWithErr(
  func: () => Promise<any>,
  err: string[]
): Promise<boolean> {
  let reverted = false;
  let errorGotten = "";

  try {
    await func();
  } catch (e: any) {
    reverted = true;
    errorGotten = inspect(e);
  }

  if (!reverted) return false;

  const found = err
    .map((x) => errorGotten.search(x) != -1)
    .reduce((a, b) => a && b, true);

  if (!found)
    console.log(
      `revertsWithErr: tx reverted with different error, expected ${err}, got ${errorGotten}`
    );

  return reverted && found;
}

const CURRENT_CHAIN = "sol.devnet";
const CURRENT_CHAIN_BUFFER = Buffer.from(
  CURRENT_CHAIN.padEnd(32, "\0"),
  "ascii"
);
const CURRENT_CHAIN_B32 = { byte: Array.from(CURRENT_CHAIN_BUFFER) };
const TO_CHAIN = "evm.31337";
const TO_CHAIN_BUFFER = Buffer.from(TO_CHAIN.padEnd(32, "\0"), "ascii");
const TO_CHAIN_B32 = { byte: Array.from(TO_CHAIN_BUFFER) };
const TO_CHAIN2 = "evm.1337";
const TO_CHAIN2_BUFFER = Buffer.from(TO_CHAIN2.padEnd(32, "\0"), "ascii");
const TO_CHAIN2_B32 = { byte: Array.from(TO_CHAIN2_BUFFER) };
const TEST_ETH_ADDRESS = "0xeF16b7ECC977276CEb7f3c9689200bF9DF54a8c5";
const VERSION = new anchor.BN(0);

describe("bridge-solana", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BridgeSolana as Program<BridgeSolana>;
  const owner = new anchor.web3.Keypair();

  const createMint = async (): Promise<anchor.web3.PublicKey> => {
    const tokenMint = new anchor.web3.Keypair();
    const lamportsForMint =
      await provider.connection.getMinimumBalanceForRentExemption(
        spl.MintLayout.span
      );
    let tx = new anchor.web3.Transaction();

    // Allocate mint
    tx.add(
      anchor.web3.SystemProgram.createAccount({
        programId: spl.TOKEN_PROGRAM_ID,
        space: spl.MintLayout.span,
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: tokenMint.publicKey,
        lamports: lamportsForMint,
      })
    );
    // Allocate wallet account
    tx.add(
      spl.createInitializeMintInstruction(
        tokenMint.publicKey,
        6,
        provider.wallet.publicKey,
        provider.wallet.publicKey
      )
    );
    const signature = await provider.sendAndConfirm(tx, [tokenMint]);

    console.log(
      `[${tokenMint.publicKey}] Created new mint account at ${signature}`
    );
    return tokenMint.publicKey;
  };

  const createUserAndAssociatedWallet = async (
    mint?: anchor.web3.PublicKey
  ): Promise<[anchor.web3.Keypair, anchor.web3.PublicKey | undefined]> => {
    const user = new anchor.web3.Keypair();
    let userAssociatedTokenAccount: anchor.web3.PublicKey | undefined =
      undefined;

    // Fund user with some SOL
    let txFund = new anchor.web3.Transaction();
    txFund.add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: user.publicKey,
        lamports: 5 * anchor.web3.LAMPORTS_PER_SOL,
      })
    );
    const sigTxFund = await provider.sendAndConfirm(txFund);
    console.log(
      `[${user.publicKey.toBase58()}] Funded new account with 5 SOL: ${sigTxFund}`
    );

    if (mint) {
      // Create a token account for the user and mint some tokens
      userAssociatedTokenAccount = await spl.getAssociatedTokenAddress(
        mint,
        user.publicKey,
        false,
        spl.TOKEN_PROGRAM_ID,
        spl.ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const txFundTokenAccount = new anchor.web3.Transaction();
      txFundTokenAccount.add(
        spl.createAssociatedTokenAccountInstruction(
          user.publicKey,
          userAssociatedTokenAccount,
          user.publicKey,
          mint,
          spl.TOKEN_PROGRAM_ID,
          spl.ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
      txFundTokenAccount.add(
        spl.createMintToInstruction(
          mint,
          userAssociatedTokenAccount,
          provider.wallet.publicKey,
          1337000000,
          [],
          spl.TOKEN_PROGRAM_ID
        )
      );
      const txFundTokenSig = await provider.sendAndConfirm(txFundTokenAccount, [
        user,
      ]);
      console.log(
        `[${userAssociatedTokenAccount.toBase58()}] New associated account for mint ${mint.toBase58()}: ${txFundTokenSig}`
      );
    }
    return [user, userAssociatedTokenAccount];
  };

  const getBridgeUserAccount = (
    name: string,
    bridgeOwner: anchor.web3.PublicKey,
    tokenMint: anchor.web3.PublicKey,
    user: anchor.web3.PublicKey
  ) => {
    return PublicKey.findProgramAddressSync(
      [
        VERSION.toBuffer("be", 8),
        Buffer.from(name),
        bridgeOwner.toBuffer(),
        tokenMint.toBuffer(),
        user.toBuffer(),
        CURRENT_CHAIN_BUFFER,
      ],
      program.programId
    );
  };

  const getBridgeAccount = (
    name: string,
    bridgeOwner: anchor.web3.PublicKey,
    tokenMint: anchor.web3.PublicKey
  ) => {
    return PublicKey.findProgramAddressSync(
      [
        VERSION.toBuffer("be", 8),
        Buffer.from(name),
        bridgeOwner.toBuffer(),
        tokenMint.toBuffer(),
        CURRENT_CHAIN_BUFFER,
      ],
      program.programId
    );
  };

  const getChainDataAccount = (
    bridgeOwner: anchor.web3.PublicKey,
    tokenMint: anchor.web3.PublicKey,
    toChainBuffer: Buffer
  ) => {
    return PublicKey.findProgramAddressSync(
      [
        VERSION.toBuffer("be", 8),
        Buffer.from("chain_data"),
        bridgeOwner.toBuffer(),
        tokenMint.toBuffer(),
        CURRENT_CHAIN_BUFFER,
        toChainBuffer,
      ],
      program.programId
    );
  };

  const getSendTxAccount = (
    bridgeOwner: anchor.web3.PublicKey,
    tokenMint: anchor.web3.PublicKey,
    user: anchor.web3.PublicKey,
    nonce: anchor.BN
  ) => {
    return PublicKey.findProgramAddressSync(
      [
        VERSION.toBuffer("be", 8),
        Buffer.from("send_tx"),
        bridgeOwner.toBuffer(),
        tokenMint.toBuffer(),
        user.toBuffer(),
        nonce.toBuffer("be", 8),
        CURRENT_CHAIN_BUFFER,
      ],
      program.programId
    );
  };

  const getEmptyAccount = (
    bridgeOwner: anchor.web3.PublicKey,
    tokenMint: anchor.web3.PublicKey,
    fromChain: Buffer,
    nonce: anchor.BN
  ) => {
    return PublicKey.findProgramAddressSync(
      [
        VERSION.toBuffer("be", 8),
        Buffer.from("fulfilled"),
        bridgeOwner.toBuffer(),
        tokenMint.toBuffer(),
        nonce.toBuffer("be", 8),
        fromChain,
        CURRENT_CHAIN_BUFFER,
      ],
      program.programId
    );
  };

  let tokenMint: anchor.web3.PublicKey;
  let bridgeTokenAccount: anchor.web3.PublicKey;
  let ownerAssociatedTokenAccount: anchor.web3.PublicKey;
  let bridgeParams: anchor.web3.PublicKey;
  let toChainData: anchor.web3.PublicKey;
  let toChainData2: anchor.web3.PublicKey;

  before(async () => {
    await provider.connection.requestAirdrop(
      owner.publicKey,
      100 * LAMPORTS_PER_SOL
    );

    tokenMint = await createMint();
    bridgeTokenAccount = getBridgeAccount(
      "wallet",
      owner.publicKey,
      tokenMint
    )[0];
    ownerAssociatedTokenAccount = await spl.createAssociatedTokenAccount(
      provider.connection,
      owner,
      tokenMint,
      owner.publicKey
    );
    bridgeParams = getBridgeAccount(
      "bridge_params",
      owner.publicKey,
      tokenMint
    )[0];
    toChainData = getChainDataAccount(
      owner.publicKey,
      tokenMint,
      TO_CHAIN_BUFFER
    )[0];
    toChainData2 = getChainDataAccount(
      owner.publicKey,
      tokenMint,
      TO_CHAIN2_BUFFER
    )[0];
  });

  it("initialize fails with bad params", async () => {
    console.log("bridgeTokenAccount", bridgeTokenAccount.toBase58());

    expect(
      await revertsWithErr(
        () =>
          program.methods
            .initialize(
              10000,
              0,
              new anchor.BN(999999999),
              false,
              VERSION,
              CURRENT_CHAIN_B32
            )
            .accounts({
              tokenMint,
              bridgeTokenAccount,
              owner: owner.publicKey,
              feeAccount: ownerAssociatedTokenAccount,
              bridgeParams,
            })
            .signers([owner])
            .rpc(),
        Error.SendFeeTooHigh
      )
    ).to.be.true;

    expect(
      await revertsWithErr(
        () =>
          program.methods
            .initialize(
              0,
              10000,
              new anchor.BN(999999999),
              false,
              VERSION,
              CURRENT_CHAIN_B32
            )
            .accounts({
              tokenMint,
              bridgeTokenAccount,
              owner: owner.publicKey,
              feeAccount: ownerAssociatedTokenAccount,
              bridgeParams,
            })
            .signers([owner])
            .rpc(),
        Error.FulfillFeeTooHigh
      )
    ).to.be.true;
  });

  function setChainData(chainB32, chainData, exchangeRate) {
    return program.methods
      .setChainData(
        tokenMint,
        true,
        exchangeRate,
        VERSION,
        CURRENT_CHAIN_B32,
        chainB32
      )
      .accounts({
        owner: owner.publicKey,
        chainData,
      })
      .signers([owner])
      .rpc({ skipPreflight: true });
  }

  it("Is initialized!", async () => {
    const tx = await program.methods
      .initialize(
        0,
        0,
        new anchor.BN(999999999),
        false,
        VERSION,
        CURRENT_CHAIN_B32
      )
      .accounts({
        tokenMint,
        bridgeTokenAccount,
        owner: owner.publicKey,
        feeAccount: ownerAssociatedTokenAccount,
        bridgeParams,
      })
      .signers([owner])
      .rpc({ skipPreflight: true });
    console.log("Your transaction signature", tx);

    const tx2 = await setChainData(TO_CHAIN_B32, toChainData, new anchor.BN(1));
    console.log("Your transaction signature", tx2);

    const tx3 = await setChainData(
      TO_CHAIN2_B32,
      toChainData2,
      new anchor.BN(1)
    );
    console.log("Your transaction signature", tx3);
  });

  it("shouldnt set bad chain params", async () => {
    expect(
      await revertsWithErr(
        () => setChainData(TO_CHAIN_B32, toChainData, new anchor.BN(0)),
        ["ExchangeRateZero"]
      )
    ).to.be.true;
  });

  let user: anchor.web3.Keypair;
  let userTokenAccount: anchor.web3.PublicKey;
  let user2: anchor.web3.Keypair;
  let userTokenAccount2: anchor.web3.PublicKey;

  async function send(
    toChainB32,
    toChainData_,
    user_,
    userTokenAccount_,
    nonce
  ) {
    const sendNonce = getBridgeUserAccount(
      "send_nonce",
      owner.publicKey,
      tokenMint,
      user_.publicKey
    )[0];
    const sendNonceAccount = await program.account.userNonce.fetchNullable(
      sendNonce
    );
    // const nonce = sendNonceAccount?.nonce || new anchor.BN(0)
    const sendTx = getSendTxAccount(
      owner.publicKey,
      tokenMint,
      user_.publicKey,
      nonce
    )[0];

    return {
      tx: await program.methods
        .send(
          owner.publicKey,
          tokenMint,
          new anchor.BN(133769),
          ethAddress(TEST_ETH_ADDRESS),
          VERSION,
          toChainB32,
          CURRENT_CHAIN_B32
        )
        .accounts({
          sendTx,
          sendNonce,
          userTokenAccount: userTokenAccount_,
          bridgeTokenAccount,
          user: user_.publicKey,
          feeAccount: ownerAssociatedTokenAccount,
          toChainData: toChainData_,
          bridgeParams,
        })
        .signers([user_])
        .rpc({ skipPreflight: true }),
      sendNonce,
      sendTx,
    };
  }

  it("sends tokens", async () => {
    [user, userTokenAccount] = await createUserAndAssociatedWallet(tokenMint);
    const { tx, sendNonce, sendTx } = await send(
      TO_CHAIN_B32,
      toChainData,
      user,
      userTokenAccount,
      new anchor.BN(0)
    );

    expect(
      (await program.account.userNonce.fetch(sendNonce)).nonce.eq(
        new anchor.BN(1)
      )
    ).to.eq(true);
    console.log("Your transaction signature", tx);

    const sendTxAccount = await program.account.bridgeSendTx.fetch(sendTx);
    expect(sendTxAccount.initiator.toBase58()).to.eq(user.publicKey.toBase58());
    expect(sendTxAccount.amount.eq(new anchor.BN(133769))).to.eq(true);
    expect(sendTxAccount.to.byte).to.deep.eq(ethAddress(TEST_ETH_ADDRESS).byte);
    expect(sendTxAccount.nonce.eq(new anchor.BN(0))).to.eq(true);
  });

  it("should prevent sending with the same nonce", async () => {
    expect(
      await revertsWithLog(
        () =>
          send(
            TO_CHAIN_B32,
            toChainData,
            user,
            userTokenAccount,
            new anchor.BN(0)
          ),
        ["send_tx", "A seeds constraint was violated"]
      )
    ).to.be.true;
  });

  it("sends allow to use the same nonce for a different user", async () => {
    [user2, userTokenAccount2] = await createUserAndAssociatedWallet(tokenMint);
    const { tx, sendNonce, sendTx } = await send(
      TO_CHAIN_B32,
      toChainData,
      user2,
      userTokenAccount2,
      new anchor.BN(0)
    );

    expect(
      (await program.account.userNonce.fetch(sendNonce)).nonce.eq(
        new anchor.BN(1)
      )
    ).to.eq(true);
    console.log("Your transaction signature", tx);

    const sendTxAccount = await program.account.bridgeSendTx.fetch(sendTx);
    expect(sendTxAccount.initiator.toBase58()).to.eq(
      user2.publicKey.toBase58()
    );
    expect(sendTxAccount.amount.eq(new anchor.BN(133769))).to.eq(true);
    expect(sendTxAccount.to.byte).to.deep.eq(ethAddress(TEST_ETH_ADDRESS).byte);
    expect(sendTxAccount.nonce.eq(new anchor.BN(0))).to.eq(true);

    expect(
      await revertsWithLog(
        () =>
          send(
            TO_CHAIN_B32,
            toChainData,
            user2,
            userTokenAccount2,
            new anchor.BN(0)
          ),
        ["send_tx", "A seeds constraint was violated"]
      )
    ).to.be.true;
  });

  async function fulfill(
    toChainB32,
    toChainBuffer,
    toChainDataAcc,
    user_: anchor.web3.Keypair,
    userTokenAccount_: PublicKey,
    nonce: anchor.BN
  ) {
    const amount = new anchor.BN(1337);

    const instruction = await program.methods
      .fulfill(nonce, amount, VERSION, CURRENT_CHAIN_B32, toChainB32)
      .accounts({
        tokenMint,
        userTokenAccount: userTokenAccount_,
        bridgeTokenAccount,
        user: user_.publicKey,
        owner: owner.publicKey,
        feeAccount: ownerAssociatedTokenAccount,
        bridgeParams,
        emptyAccount: getEmptyAccount(
          owner.publicKey,
          tokenMint,
          toChainBuffer,
          nonce
        )[0],
        fromChainData: toChainDataAcc,
      })
      .instruction();

    const tx = new anchor.web3.Transaction();
    tx.add(instruction);
    tx.feePayer = user_.publicKey;
    tx.recentBlockhash = (
      await provider.connection.getLatestBlockhash()
    ).blockhash;
    tx.partialSign(owner);

    const serializedTx = tx.serialize({ requireAllSignatures: false });
    const tx2 = anchor.web3.Transaction.from(serializedTx);
    tx2.partialSign(user_);
    const txHash = await provider.connection.sendRawTransaction(
      tx2.serialize()
    );
    await provider.connection.confirmTransaction(txHash);
    return txHash;
  }

  it("fulfills", async () => {
    console.log(
      "Your transaction signature",
      await fulfill(
        TO_CHAIN_B32,
        TO_CHAIN_BUFFER,
        toChainData,
        user,
        userTokenAccount,
        new anchor.BN(1)
      )
    );
  });

  it("fulfills from another chain", async () => {
    console.log(
      "Your transaction signature",
      await fulfill(
        TO_CHAIN2_B32,
        TO_CHAIN2_BUFFER,
        toChainData2,
        user,
        userTokenAccount,
        new anchor.BN(1)
      )
    );
  });

  it("should not fulfill with an already used nonce for the same user", async () => {
    expect(
      await revertsWithErr(
        () =>
          fulfill(
            TO_CHAIN_B32,
            TO_CHAIN_BUFFER,
            toChainData,
            user,
            userTokenAccount,
            new anchor.BN(1)
          ),
        ["Allocate: account", "already in use"]
      )
    ).to.be.true;
  });

  it("should not fulfill with an already used nonce for a different user", async () => {
    expect(
      await revertsWithErr(
        () =>
          fulfill(
            TO_CHAIN_B32,
            TO_CHAIN_BUFFER,
            toChainData,
            user2,
            userTokenAccount2,
            new anchor.BN(1)
          ),
        ["Allocate: account", "already in use"]
      )
    ).to.be.true;
  });

  it("should fulfill for a different user and invalidate the nonce", async () => {
    console.log(
      "Your transaction signature",
      await fulfill(
        TO_CHAIN_B32,
        TO_CHAIN_BUFFER,
        toChainData,
        user2,
        userTokenAccount2,
        new anchor.BN(2)
      )
    );
    expect(
      await revertsWithErr(
        () =>
          fulfill(
            TO_CHAIN_B32,
            TO_CHAIN_BUFFER,
            toChainData,
            user,
            userTokenAccount,
            new anchor.BN(2)
          ),
        ["Allocate: account", "already in use"]
      )
    ).to.be.true;
    expect(
      await revertsWithErr(
        () =>
          fulfill(
            TO_CHAIN_B32,
            TO_CHAIN_BUFFER,
            toChainData,
            user2,
            userTokenAccount2,
            new anchor.BN(2)
          ),
        ["Allocate: account", "already in use"]
      )
    ).to.be.true;
  });

  function withdraw(owner_?: anchor.web3.Keypair) {
    if (!owner_) owner_ = owner;

    return program.methods
      .withdraw(VERSION, CURRENT_CHAIN_B32)
      .accounts({
        tokenMint,
        bridgeTokenAccount,
        owner: owner_.publicKey,
        withdrawTokenAccount: userTokenAccount,
      })
      .signers([owner_])
      .rpc();
  }

  it("should not withdraw from another wallet", async () => {
    expect(
      await revertsWithErr(
        () => withdraw(user),
        [
          "AnchorError caused by account: bridge_token_account. Error Code: ConstraintSeeds. Error Number: 2006. Error Message: A seeds constraint was violated.",
        ]
      )
    ).to.be.true;
  });

  it("should withdraw", async () => {
    const prevAccount = await spl.getAccount(
      provider.connection,
      userTokenAccount
    );

    const tx = await withdraw();
    console.log("Your transaction signature", tx);

    const afterAccount = await spl.getAccount(
      provider.connection,
      userTokenAccount
    );
    expect(afterAccount.amount - prevAccount.amount).to.eq(
      BigInt(133769 * 2 - 1337 * 3)
    );
  });

  it("should not withdraw zero", async () => {
    expect(await revertsWithErr(withdraw, ["WithdrawZero"])).to.be.true;
  });

  it("should not withdraw from another wallet", async () => {
    expect(
      await revertsWithErr(
        () =>
          spl.transfer(
            provider.connection,
            user,
            bridgeTokenAccount,
            userTokenAccount,
            owner.publicKey,
            1337
          ),
        ["Signature verification failed"]
      )
    ).to.be.true;
  });

  it("should not set fees from another wallet", async () => {
    expect(
      await revertsWithErr(
        () =>
          program.methods
            .setParams(
              tokenMint,
              500,
              500,
              new anchor.BN(999999998),
              false,
              VERSION,
              CURRENT_CHAIN_B32
            )
            .accounts({
              bridgeParams,
              owner: owner.publicKey,
              feeAccount: ownerAssociatedTokenAccount,
            })
            .signers([user])
            .rpc({ skipPreflight: true }),
        ["unknown signer"]
      )
    ).to.be.true;
  });

  it("should not set fees with bad params", async () => {
    expect(
      await revertsWithErr(
        () =>
          program.methods
            .setParams(
              tokenMint,
              10000,
              500,
              new anchor.BN(999999998),
              false,
              VERSION,
              CURRENT_CHAIN_B32
            )
            .accounts({
              bridgeParams,
              owner: owner.publicKey,
              feeAccount: ownerAssociatedTokenAccount,
            })
            .signers([owner])
            .rpc({ skipPreflight: true }),
        Error.SendFeeTooHigh
      )
    ).to.be.true;
    expect(
      await revertsWithErr(
        () =>
          program.methods
            .setParams(
              tokenMint,
              500,
              10000,
              new anchor.BN(999999998),
              false,
              VERSION,
              CURRENT_CHAIN_B32
            )
            .accounts({
              bridgeParams,
              owner: owner.publicKey,
              feeAccount: ownerAssociatedTokenAccount,
            })
            .signers([owner])
            .rpc({ skipPreflight: true }),
        Error.FulfillFeeTooHigh
      )
    ).to.be.true;
  });

  it("should set fee & params", async () => {
    const tx = await program.methods
      .setParams(
        tokenMint,
        500,
        500,
        new anchor.BN(133769),
        false,
        VERSION,
        CURRENT_CHAIN_B32
      )
      .accounts({
        bridgeParams,
        owner: owner.publicKey,
        feeAccount: ownerAssociatedTokenAccount,
      })
      .signers([owner])
      .rpc({ skipPreflight: true });
  });

  it("should send with fee", async () => {
    const sendNonce = getBridgeUserAccount(
      "send_nonce",
      owner.publicKey,
      tokenMint,
      user.publicKey
    )[0];
    const sendNonceAccount = await program.account.userNonce.fetchNullable(
      sendNonce
    );
    const nonce = sendNonceAccount?.nonce || new anchor.BN(0);
    const sendTx = getSendTxAccount(
      owner.publicKey,
      tokenMint,
      user.publicKey,
      nonce
    )[0];

    const amount = new anchor.BN(133769);
    const fee = amount.mul(new anchor.BN(500)).div(new anchor.BN(10000));
    const amount_par_fee = amount.sub(fee);

    const tx = await program.methods
      .send(
        owner.publicKey,
        tokenMint,
        new anchor.BN(133769),
        ethAddress(TEST_ETH_ADDRESS),
        VERSION,
        TO_CHAIN_B32,
        CURRENT_CHAIN_B32
      )
      .accounts({
        sendTx,
        sendNonce,
        userTokenAccount,
        bridgeTokenAccount,
        user: user.publicKey,
        toChainData,
        feeAccount: ownerAssociatedTokenAccount,
        bridgeParams,
      })
      .signers([user])
      .rpc({ skipPreflight: true });

    expect(
      (await program.account.userNonce.fetch(sendNonce)).nonce.eq(
        nonce.add(new anchor.BN(1))
      )
    ).to.eq(true);
    console.log("Your transaction signature", tx);

    const sendTxAccount = await program.account.bridgeSendTx.fetch(sendTx);
    expect(sendTxAccount.initiator.toBase58()).to.eq(user.publicKey.toBase58());
    expect(sendTxAccount.amount.eq(amount_par_fee)).to.eq(true);
    expect(sendTxAccount.to.byte).to.deep.eq(ethAddress(TEST_ETH_ADDRESS).byte);
    expect(sendTxAccount.nonce.eq(nonce)).to.eq(true);
  });

  it("should prevent sending with 0 amount", async () => {
    const sendNonce = getBridgeUserAccount(
      "send_nonce",
      owner.publicKey,
      tokenMint,
      user.publicKey
    )[0];
    const sendNonceAccount = await program.account.userNonce.fetchNullable(
      sendNonce
    );
    const nonce = sendNonceAccount?.nonce || new anchor.BN(0);
    const sendTx = getSendTxAccount(
      owner.publicKey,
      tokenMint,
      user.publicKey,
      nonce
    )[0];

    expect(
      await revertsWithErr(
        () =>
          program.methods
            .send(
              owner.publicKey,
              tokenMint,
              new anchor.BN(0),
              ethAddress(TEST_ETH_ADDRESS),
              VERSION,
              TO_CHAIN_B32,
              CURRENT_CHAIN_B32
            )
            .accounts({
              sendTx,
              sendNonce,
              userTokenAccount,
              bridgeTokenAccount,
              user: user.publicKey,
              feeAccount: ownerAssociatedTokenAccount,
              toChainData,
              bridgeParams,
            })
            .signers([user])
            .rpc({ skipPreflight: true }),
        ["AmountTooLow"]
      )
    ).to.be.true;
  });
  it("should prevent sending with amount over the send limit", async () => {
    const sendNonce = getBridgeUserAccount(
      "send_nonce",
      owner.publicKey,
      tokenMint,
      user.publicKey
    )[0];
    const sendNonceAccount = await program.account.userNonce.fetchNullable(
      sendNonce
    );
    const nonce = sendNonceAccount?.nonce || new anchor.BN(0);
    const sendTx = getSendTxAccount(
      owner.publicKey,
      tokenMint,
      user.publicKey,
      nonce
    )[0];

    expect(
      await revertsWithErr(
        () =>
          program.methods
            .send(
              owner.publicKey,
              tokenMint,
              new anchor.BN(133770),
              ethAddress(TEST_ETH_ADDRESS),
              VERSION,
              TO_CHAIN_B32,
              CURRENT_CHAIN_B32
            )
            .accounts({
              sendTx,
              sendNonce,
              userTokenAccount,
              bridgeTokenAccount,
              user: user.publicKey,
              feeAccount: ownerAssociatedTokenAccount,
              toChainData,
              bridgeParams,
            })
            .signers([user])
            .rpc({ skipPreflight: true }),
        ["SendLimitExceeded"]
      )
    ).to.be.true;
  });
});
