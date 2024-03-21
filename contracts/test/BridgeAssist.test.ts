import { ethers } from 'hardhat'
import { expect } from 'chai'

import { deploy, useContracts } from '@/test'
import { BigNumber, BigNumberish } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BridgeAssist__factory } from '@/typechain'

const ERROR = {
  Limit: 'Amount is more than limit',
  WrongSignature: 'Bad signature at index0',
  FulfilledSignature: 'Signature already fulfilled',
  WrongChain: 'Wrong "toChain" in tx struct',
  WrongFromChain: 'Not supported fromChain',
  ZeroAmount: 'Amount = 0',
  AmountNotWhole: 'Amount is not divisible by exchange rate',
  AmountTooSmall: 'amount < fee denominator',
  EmptyToUser: 'Field toUser is empty',
  FeeWalletRepeat: 'Fee wallet repeats',
  LimitPerSendRepeat: 'Limit per send repeats',
  FeeRepeat: 'Fee numerator repeats',
  FeeToHigh: 'Fee is too high',
  UnknownChain: 'Chain is not supported',
  ChainAlreadyInList: 'Chain is already in the list',
  ChainNotInList: 'Chain is not in the list yet',
  WrongLengthAddress: 'toAddress_outOfBounds',
  NotEvenLength: 'Not even length',
  ZeroAddressFeeWallet: 'Fee wallet is zero address',
  Paused: 'Pausable: paused',
  NotPaused: 'Pausable: not paused',
  ExchangeRateModified: 'cannot modify the exchange rate',
  UnderOverFlow: 'Arithmetic operation underflowed or overflowed outside of an unchecked block',
  BadToken: 'bad token',
  BadInput: 'bad input',
  BadOffsetLimit: 'bad offset/limit',
  NoRelayers: 'No relayers',
  TooManyRelayers: 'Too many relayers',
  ZeroOfN: '0-of-N',
  NOfN: 'N-of-N',
  DuplicateRelayers: 'Duplicate relayers',
}

const feePercent = 1000 // eq 1000 / 10000 = 10%
const nearAddress = 'gotbit.testnet'
const nearAddress1 = 'gotbit.testnet1'
const nearAddress2 = 'gotbit.testnet2'

// const evmChain = 'BSC'
const evmChain = 'evm.31337'
const CHAIN_ID = 31337
const nearChain = 'NEAR'

const EIP712DOMAIN_NAME = 'BridgeAssist'
const EIP712DOMAIN_VERSION = '1.0'

const eip712Transaction = {
  name: 'FulfillTx',
  fields: [
    { name: 'amount', type: 'uint256' },
    { name: 'fromUser', type: 'string' },
    { name: 'toUser', type: 'address' },
    { name: 'fromChain', type: 'string' },
    { name: 'nonce', type: 'uint256' },
  ],
}

type Transaction = {
  amount: BigNumberish
  timestamp: BigNumberish
  fromChain: string
  toChain: string
  nonce: BigNumberish
  fromUser: string
  toUser: string
}

type FulfillTx = {
  amount: BigNumberish
  fromChain: string
  nonce: BigNumberish
  fromUser: string
  toUser: string
}

export async function signHashedTransaction(
  signer: SignerWithAddress,
  transaction: FulfillTx,
  chainId: number,
  contractAddress: string
): Promise<string> {
  const domain = {
    name: EIP712DOMAIN_NAME,
    version: EIP712DOMAIN_VERSION,
    chainId,
    verifyingContract: contractAddress,
  }
  const types = {
    [eip712Transaction.name]: eip712Transaction.fields,
  }

  return signer._signTypedData(domain, types, transaction)
}

describe('BridgeAssist contract', () => {
  beforeEach(async () => {
    await deploy()
    // const { token, bridge } = await deploy()
    // const [deployer] = await ethers.getSigners()
  })
  it('constructor requires', async function () {
    const [deployer, relayer] = await ethers.getSigners()
    const {token} = await useContracts()
    const factory = await ethers.getContractFactory<BridgeAssist__factory>('BridgeAssist')
    const zero = ethers.constants.AddressZero

    await expect(
      factory.deploy(
        zero,
        ethers.utils.parseEther('100'),
        deployer.address,
        0,
        0,
        deployer.address,
        [relayer.address],
        1
      )
    ).to.be.revertedWith('Token is zero address')

    await expect(
      factory.deploy(
        token.address,
        ethers.utils.parseEther('100'),
        zero,
        0,
        0,
        deployer.address,
        [relayer.address],
        1
      )
    ).to.be.revertedWith('Fee wallet is zero address')

    await expect(
      factory.deploy(
        token.address,
        ethers.utils.parseEther('100'),
        deployer.address,
        0,
        0,
        zero,
        [relayer.address],
        1
      )
    ).to.be.revertedWith('Owner is zero address')

    await expect(
      factory.deploy(
        token.address,
        ethers.utils.parseEther('100'),
        deployer.address,
        10_000,
        0,
        deployer.address,
        [relayer.address],
        1
      )
    ).to.be.revertedWith('Fee send is too high')

    await expect(
      factory.deploy(
        token.address,
        ethers.utils.parseEther('100'),
        deployer.address,
        0,
        10_000,
        deployer.address,
        [relayer.address],
        1
      )
    ).to.be.revertedWith('Fee fulfill is too high')

    await expect(
      factory.deploy(
        token.address,
        ethers.utils.parseEther('100'),
        deployer.address,
        0,
        0,
        deployer.address,
        [],
        1
      )
    ).to.be.revertedWith(ERROR.NoRelayers)

    await expect(
      factory.deploy(
        token.address,
        ethers.utils.parseEther('100'),
        deployer.address,
        0,
        0,
        deployer.address,
        Array(101).fill(relayer.address),
        1,
        {gasLimit: 30_000_000}
      )
    ).to.be.revertedWith(ERROR.TooManyRelayers)

    await expect(
      factory.deploy(
        token.address,
        ethers.utils.parseEther('100'),
        deployer.address,
        0,
        0,
        deployer.address,
        [relayer.address, deployer.address, relayer.address],
        1
      )
    ).to.be.revertedWith(ERROR.DuplicateRelayers)

    await expect(
      factory.deploy(
        token.address,
        ethers.utils.parseEther('100'),
        deployer.address,
        0,
        0,
        deployer.address,
        [relayer.address],
        0
      )
    ).to.be.revertedWith(ERROR.ZeroOfN)

    await expect(
      factory.deploy(
        token.address,
        ethers.utils.parseEther('100'),
        deployer.address,
        0,
        0,
        deployer.address,
        [relayer.address],
        2
      )
    ).to.be.revertedWith(ERROR.NOfN)
  })
  it('should send tokens', async () => {
    const { token, bridge } = await useContracts()
    const [deployer, , user] = await ethers.getSigners()
    const bridgeAmountBefore = await token.balanceOf(bridge.address)
    const exchangeRate = await bridge.exchangeRateFrom(
      ethers.utils.formatBytes32String(nearChain)
    )
    const feeDenominator = await bridge.FEE_DENOMINATOR()
    const amount = '100'.toBigNumber(18)

    await expect(
      bridge.connect(user).send(exchangeRate.sub(1), nearAddress, nearChain)
    ).to.be.revertedWith(ERROR.AmountNotWhole)
    await expect(
      bridge.connect(user).send(exchangeRate, nearAddress, nearChain)
    ).to.be.revertedWith(ERROR.AmountTooSmall)

    await expect(bridge.connect(user).send(0, nearAddress, nearChain)).to.be.revertedWith(
      ERROR.ZeroAmount
    )
    await expect(bridge.connect(user).send(amount, '', nearChain)).to.be.revertedWith(
      ERROR.EmptyToUser
    )
    await expect(
      bridge.connect(user).send(amount, 'somechainusername', 'UNKNOWN_CHAIN')
    ).to.be.revertedWith(ERROR.UnknownChain)

    // send tokens to user
    await token.connect(deployer).transfer(user.address, amount)

    await token.connect(user).approve(bridge.address, amount)
    await bridge.connect(user).send(amount, nearAddress, nearChain)

    const transactions = await bridge.getUserTransactions(user.address.toLowerCase())
    const tx = transactions[0]

    expect(tx.fromUser.toLowerCase()).eq(user.address.toLowerCase())
    expect(tx.toUser).eq(nearAddress)
    expect(tx.amount.mul('1'.toBigNumber(9))).eq(amount)
    expect(tx.fromChain).eq(evmChain)
    expect(tx.toChain).eq(nearChain)
    expect(tx.nonce).eq(0)
    expect(await token.balanceOf(user.address)).eq(0)
    expect(await token.balanceOf(bridge.address)).eq(bridgeAmountBefore.add(amount))
    expect(await bridge.getUserTransactionsAmount(user.address)).to.eq(1)

    expect(await bridge.getUserTransactionsSlice(user.address, 0, 1)).is.deep.equal([tx])
    expect(bridge.getUserTransactionsSlice(user.address, 1, 1)).to.be.revertedWith(ERROR.BadOffsetLimit)

    expect(await bridge.nonce()).eq(1)
  })
  it('should fulfill tokens from bridge preventing double-spend', async () => {
    const { token, bridge } = await useContracts()
    const [deployer, relayer, user] = await ethers.getSigners()

    const wrongChainTx = {
      fromUser: nearAddress,
      toUser: user.address,
      amount: '10'.toBigNumber(9),
      fromChain: nearChain,
      nonce: '0'.toBigNumber(),
    }

    const tx = {
      fromUser: nearAddress,
      toUser: user.address,
      amount: '10'.toBigNumber(9),
      fromChain: nearChain,
      nonce: '0'.toBigNumber(),
    }

    const wrongFromChainTx = {
      fromUser: nearAddress,
      toUser: user.address,
      amount: '10'.toBigNumber(9),
      fromChain: 'UNKNOWN CHAIN',
      nonce: '0'.toBigNumber(),
    }

    // sign by relayer transaction

    const signature = await signHashedTransaction(relayer, tx, CHAIN_ID, bridge.address)
    const fakeSignature = await signHashedTransaction(
      deployer,
      tx,
      CHAIN_ID,
      bridge.address
    )

    await expect(bridge.connect(user).fulfill(wrongFromChainTx, [signature])).revertedWith(
      ERROR.WrongFromChain
    )

    await expect(bridge.connect(user).fulfill(tx, [fakeSignature])).revertedWith(
      ERROR.WrongSignature
    )
    await expect(bridge.connect(user).fulfill(tx, ['0x'])).revertedWith(
      'Not enough relayers'
    )
    await expect(bridge.connect(user).fulfill(tx, [])).revertedWith(
      'Bad signatures length'
    )
    await bridge.connect(user).fulfill(tx, [signature])

    // no fee withdrawing in this test cause we hadn't setuped it yet
    expect(await token.balanceOf(user.address)).eq(tx.amount.mul('1'.toBigNumber(9)))

    await expect(bridge.connect(user).fulfill(tx, [signature])).revertedWith(
      ERROR.FulfilledSignature
    )
  })
  it('multiple users test', async () => {
    const { token, bridge } = await useContracts()
    const [deployer, relayer, user, user1, user2] = await ethers.getSigners()

    const tx = {
      fromUser: nearAddress,
      toUser: user.address,
      amount: '10'.toBigNumber(9),
      fromChain: nearChain,
      nonce: '0'.toBigNumber(),
    }

    const tx1 = {
      fromUser: nearAddress1,
      toUser: user1.address,
      amount: '777'.toBigNumber(9),
      fromChain: nearChain,
      nonce: '1'.toBigNumber(),
    }

    const tx2 = {
      fromUser: nearAddress2,
      toUser: user2.address,
      amount: '999'.toBigNumber(9),
      fromChain: nearChain,
      nonce: '2'.toBigNumber(),
    }

    // sign by relayer transaction

    const signature = await signHashedTransaction(relayer, tx, CHAIN_ID, bridge.address)
    const signature1 = await signHashedTransaction(relayer, tx1, CHAIN_ID, bridge.address)
    const signature2 = await signHashedTransaction(relayer, tx2, CHAIN_ID, bridge.address)

    await bridge.connect(user).fulfill(tx, [signature])
    await bridge.connect(user1).fulfill(tx1, [signature1])
    await bridge.connect(user2).fulfill(tx2, [signature2])

    // no fee withdrawing in this test cause we hadn't setuped it yet
    expect(await token.balanceOf(user.address)).eq(tx.amount.mul('1'.toBigNumber(9)))
  })
  it('should take proper fee on fulfill and prevent double-spend', async () => {
    const { token, bridge } = await useContracts()
    const [deployer, relayer, user, feeWallet] = await ethers.getSigners()

    const tx = {
      fromUser: nearAddress,
      toUser: user.address.toLowerCase(),
      amount: BigNumber.from(10),
      timestamp: BigNumber.from(666),
      fromChain: nearChain,
      toChain: evmChain,
      nonce: BigNumber.from(0),
    }

    await bridge.connect(deployer).setFee(feePercent, feePercent)

    // const signature = await relayer.signMessage(ethers.utils.arrayify(hashedData))
    const signature = await signHashedTransaction(relayer, tx, CHAIN_ID, bridge.address)

    await bridge.connect(user).fulfill(tx, [signature])

    expect(await token.balanceOf(user.address)).eq(
      tx.amount
        .mul('1'.toBigNumber(9))
        .sub(tx.amount.mul('1'.toBigNumber(9)).mul(feePercent).div(10000))
    )
    expect(await token.balanceOf(feeWallet.address)).eq(
      tx.amount.mul('1'.toBigNumber(9)).mul(feePercent).div(10000)
    )

    await expect(bridge.connect(user).fulfill(tx, [signature])).revertedWith(
      ERROR.FulfilledSignature
    )
  })
  it('should not send with bad token', async () => {
    const { token, bridge } = await useContracts()
    const [deployer, , user] = await ethers.getSigners()

    // send tokens to user
    const amount = '100'.toBigNumber()
    await token.connect(deployer).transfer(user.address, amount)
    await bridge.connect(deployer).setFee(feePercent, feePercent)

    await token.connect(user).approve(bridge.address, amount)
    await token.setFee(true)
    await expect(
      bridge.connect(user).send(amount, nearAddress, nearChain)
    ).revertedWith(ERROR.BadToken)
  })
  it('should not send over the limit', async () => {
    const { token, bridge } = await useContracts()
    const [deployer, , user] = await ethers.getSigners()

    // send tokens to user
    const amount = '100'.toBigNumber()
    await token.connect(deployer).transfer(user.address, amount)
    await bridge.connect(deployer).setFee(feePercent, feePercent)

    await token.connect(user).approve(bridge.address, amount)
    await bridge.connect(user).send(amount, nearAddress, nearChain)
    await expect(
      bridge.connect(user).send(amount.add('1'.toBigNumber(9)), nearAddress, nearChain)
    ).revertedWith(ERROR.Limit)
  })
  it('should withdraw, pause, set chains, set parameters, set relayers and prevent using incorrect values', async () => {
    const { token, bridge } = await useContracts()
    const [deployer, , user, feeWallet] = await ethers.getSigners()

    await expect(bridge.connect(user).setFee(20, 20)).reverted
    await expect(bridge.connect(deployer).setFee(0, 0)).revertedWith(ERROR.FeeRepeat)
    await expect(bridge.connect(deployer).setFee(10000, 10000)).revertedWith(
      ERROR.FeeToHigh
    )
    await expect(bridge.connect(deployer).setFee(0, 10000)).revertedWith(ERROR.FeeToHigh)

    await expect(bridge.connect(deployer).setFeeWallet(feeWallet.address)).revertedWith(
      ERROR.FeeWalletRepeat
    )
    await expect(
      bridge.connect(deployer).setFeeWallet(ethers.constants.AddressZero)
    ).revertedWith(ERROR.ZeroAddressFeeWallet)
    await bridge.connect(deployer).setFeeWallet(deployer.address)
    expect(await bridge.feeWallet()).eq(deployer.address)

    await expect(
      bridge.connect(deployer).setLimitPerSend(ethers.utils.parseEther('100'))
    ).revertedWith(ERROR.LimitPerSendRepeat)
    await bridge.connect(deployer).setLimitPerSend('20000'.toBigNumber(9))
    expect(await bridge.limitPerSend()).eq('20000'.toBigNumber(9))

    const bb = await token.balanceOf(deployer.address)
    await bridge.connect(deployer).withdraw(token.address, deployer.address, 50)
    expect(await token.balanceOf(deployer.address)).eq(bb.add(50))

    await expect(bridge.connect(deployer).addChains(['AAA'], [1337])).to.be.revertedWith(
      ERROR.UnderOverFlow
    )
    await expect(bridge.connect(deployer).addChains(['NEAR'], [0])).to.be.revertedWith(
      ERROR.ChainAlreadyInList
    )
    await expect(bridge.connect(deployer).addChains(['UNKNOWN'], [0, 0])).to.be.revertedWith(
      ERROR.BadInput
    )
    await expect(bridge.connect(deployer).removeChains(['UNKNOWN'])).to.be.revertedWith(
      ERROR.ChainNotInList
    )

    expect(await bridge.supportedChainList()).deep.eq([
      ethers.utils.formatBytes32String(nearChain),
      ethers.utils.formatBytes32String('AVAX'),
    ])
    await bridge.connect(deployer).removeChains(['AVAX'])
    expect(await bridge.supportedChainList()).deep.eq([
      ethers.utils.formatBytes32String(nearChain),
    ])
    await expect(bridge.connect(deployer).addChains(['AVAX'], [5])).to.be.revertedWith(
      ERROR.ExchangeRateModified
    )

    const nearRate = await bridge.exchangeRateFrom(ethers.utils.formatBytes32String(nearChain))
    await bridge.connect(deployer).removeChains([nearChain])
    await bridge.connect(deployer).addChains([nearChain], [9])

    await bridge.connect(deployer).pause()
    // send tokens to user
    const amount = '10'.toBigNumber()
    await token.connect(deployer).transfer(user.address, amount)
    await token.connect(user).approve(bridge.address, amount)
    await expect(bridge.connect(user).send(amount, nearAddress, nearChain)).revertedWith(
      ERROR.Paused
    )
    await expect(bridge.connect(deployer).pause()).revertedWith(ERROR.Paused)

    await bridge.connect(deployer).unpause()
    await bridge.connect(user).send('10000'.toBigNumber(9), nearAddress, nearChain)
    await expect(bridge.connect(deployer).unpause()).revertedWith(ERROR.NotPaused)

    await expect(bridge.setRelayers([], 0)).to.be.revertedWith(ERROR.NoRelayers)
    await expect(bridge.setRelayers(Array(101).fill(deployer.address), 0)).to.be.revertedWith(ERROR.TooManyRelayers)
    await expect(bridge.setRelayers([user.address, deployer.address, user.address], 1)).to.be.revertedWith(ERROR.DuplicateRelayers)
    await expect(bridge.setRelayers([deployer.address], 0)).to.be.revertedWith(ERROR.ZeroOfN)
    await expect(bridge.setRelayers([deployer.address], 2)).to.be.revertedWith(ERROR.NOfN)

    await bridge.setRelayers([deployer.address], 1)
    expect(await bridge.relayerConsensusThreshold()).to.eq(1)
    expect(await bridge.relayersLength()).to.eq(1)
    expect(await bridge.relayers(0)).to.eq(deployer.address)
    expect(await bridge.getRelayers()).to.deep.eq([deployer.address])
  })
})
