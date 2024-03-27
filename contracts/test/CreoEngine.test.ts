import { ethers } from 'hardhat'
import { expect } from 'chai'

import { deploy, useContracts } from '@/test'
import { BigNumber } from 'ethers'

describe('BridgeAssist contract', () => {
  beforeEach(async () => {
    await deploy()
  })
  it('constructor requires', async function () {
    const [deployer] = await ethers.getSigners()
    const { creoEngine } = await useContracts()

    expect(await creoEngine.name()).eq('CreoEngine')
    expect(await creoEngine.symbol()).eq('CREO')
    expect(await creoEngine.totalSupply()).eq(
      BigNumber.from(1000000000).mul(BigNumber.from(10).pow(18))
    )
    expect(await creoEngine.owner()).eq(deployer.address)

    const factory = await ethers.getContractFactory('CreoEngine')
    await expect(
      factory.deploy('', 'CREO', BigNumber.from(1000000000), deployer.address)
    ).to.be.revertedWith('Name is empty')
    await expect(
      factory.deploy('CreoEngine', '', BigNumber.from(1000000000), deployer.address)
    ).to.be.revertedWith('Symbol is empty')
    await expect(
      factory.deploy('CreoEngine', 'CREO', 0, deployer.address)
    ).to.be.revertedWith('Total supply is zero')
    await expect(
      factory.deploy(
        'CreoEngine',
        'CREO',
        BigNumber.from(1000000000),
        ethers.constants.AddressZero
      )
    ).to.be.revertedWith('Owner is zero address')
  })

  it('set locked', async function () {
    const [deployer, banned] = await ethers.getSigners()
    const { creoEngine } = await useContracts()

    await creoEngine.connect(deployer).setLocked(banned.address, true)
    expect(await creoEngine.locked(banned.address)).true
    await expect(
      creoEngine.connect(deployer).setLocked(banned.address, true)
    ).revertedWith('Duplicate')
    await expect(
      creoEngine.connect(deployer).setLocked(ethers.constants.AddressZero, true)
    ).revertedWith('Zero address')
  })

  it('transfer', async function () {
    const [deployer, banned] = await ethers.getSigners()
    const { creoEngine } = await useContracts()

    await creoEngine.connect(deployer).setLocked(banned.address, true)
    await expect(
      creoEngine.connect(deployer).transfer(banned.address, BigNumber.from(100))
    ).revertedWith('Transfer is not allowed')
  })
})
