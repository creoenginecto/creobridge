import { ethers, getNamedAccounts } from 'hardhat'
import type { DeployFunction } from 'hardhat-deploy/types'

import { wrapperHRE } from '@/gotbit-tools/hardhat'
import type { BridgeAssist__factory, Token } from '@/typechain'

import { BigNumber } from 'ethers'

const func: DeployFunction = async (hre) => {
  const { deploy } = wrapperHRE(hre)
  const [deployer] = await ethers.getSigners()

  const tokenAddr = '0x9521728bF66a867BC65A93Ece4a543D817871Eb7'
  const feeWallet = '0x47FF3169C515A69Eb4f53bb5D29C0804E7E038c8'
  const relayer = '0xd614C551873f42596a5890a7f8C0bE92336B1949'

  await deploy<BridgeAssist__factory>('BridgeAssist', {
    from: deployer.address,
    args: [
      tokenAddr,
      ethers.constants.MaxUint256,
      feeWallet,
      50,
      0,
      deployer.address,
      [relayer],
      1,
    ],
    log: true
  })
}
export default func

func.tags = ['BridgeAssist.deploy']
