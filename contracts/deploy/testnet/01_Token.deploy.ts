import { ethers, getNamedAccounts } from 'hardhat'
import type { DeployFunction } from 'hardhat-deploy/types'

import { wrapperHRE } from '@/gotbit-tools/hardhat'
import type { Token__factory } from '@/typechain'
import { BigNumber } from 'ethers'

const func: DeployFunction = async (hre) => {
  const { deploy, getNamedAccounts } = wrapperHRE(hre)
  const [deployer] = await ethers.getSigners()

  await deploy<Token__factory>('Token', {
    from: deployer.address,
    args: ['CreoEngine', 'CREO', 18, BigNumber.from(200000000)],
    log: true,
    gasPrice: BigNumber.from(20).mul(BigNumber.from(10).pow(9))
  })
}
export default func

func.tags = ['Token.deploy']
