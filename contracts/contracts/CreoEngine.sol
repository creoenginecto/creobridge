// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import '@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol';
import '@openzeppelin/contracts/access/Ownable.sol';

contract CreoEngine is ERC20Burnable, Ownable {
    mapping(address => bool) public locked;

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _totalSupply,
        address _owner
    ) ERC20(_name, _symbol) {
        require(bytes(_name).length != 0, 'Name is empty');
        require(bytes(_symbol).length != 0, 'Symbol is empty');
        require(_totalSupply > 0, 'Total supply is zero');
        require(_owner != address(0), 'Owner is zero address');

        _mint(_owner, _totalSupply * (10**18));
        _transferOwnership(_owner);
    }

    function setLocked(address user, bool status) external onlyOwner {
        require(user != address(0), 'Zero address');
        require(locked[user] != status, 'Duplicate');
        locked[user] = status;
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        require(!locked[from] && !locked[to], 'Transfer is not allowed');
        super._beforeTokenTransfer(from, to, amount);
    }
}
