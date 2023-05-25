//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.7;

import "@rari-capital/solmate/src/tokens/ERC20.sol";

// Used for minting test USDC (6 decimals) in our tests
contract TestERC20USDC is ERC20("TestUSDC", "TSTUSDC", 6) {
    bool public blocked;

    constructor() {
        blocked = false;
    }

    function blockTransfer(bool blocking) external {
        blocked = blocking;
    }

    function mint(address to, uint256 amount) external returns (bool) {
        _mint(to, amount);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public override returns (bool ok) {
        if (blocked) {
            return false;
        }

        super.transferFrom(from, to, amount);

        ok = true;
    }
}
