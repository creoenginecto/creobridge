import { ethers } from 'hardhat'
import type { DeployFunction } from 'hardhat-deploy/types'

import { wrapperHRE } from '@/gotbit-tools/hardhat'
import type { CreoEngine__factory, Token__factory } from '@/typechain'
import { BigNumber } from 'ethers'

const func: DeployFunction = async (hre) => {
  const { deploy } = wrapperHRE(hre)
  const [deployer] = await ethers.getSigners()

  await deploy<CreoEngine__factory>('CreoEngine', {
    from: deployer.address,
    args: ['CreoEngine', 'CREO', BigNumber.from(1000000000), deployer.address],
    log: true,
  })
}
export default func

func.tags = ['CreoEngine.deploy']
