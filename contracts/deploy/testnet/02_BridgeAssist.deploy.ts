import { ethers, getNamedAccounts } from 'hardhat'
import type { DeployFunction } from 'hardhat-deploy/types'

import { wrapperHRE } from '@/gotbit-tools/hardhat'
import type { BridgeAssist__factory, Token } from '@/typechain'

import config from '@/config.json'
import { BigNumber } from 'ethers'

const func: DeployFunction = async (hre) => {
  const { deploy } = wrapperHRE(hre)
  const [deployer] = await ethers.getSigners()

  const token = await ethers.getContract<Token>('Token')

  await deploy<BridgeAssist__factory>('BridgeAssist', {
    from: deployer.address,
    args: [
      token.address,
      ethers.constants.MaxUint256,
      deployer.address,
      50,
      0,
      deployer.address,
      [deployer.address],
      1,
    ],
    log: true,
    gasPrice: BigNumber.from(20).mul(BigNumber.from(10).pow(9))
  })
}
export default func

func.tags = ['BridgeAssist.deploy']
func.dependencies = ['Token.deploy']
