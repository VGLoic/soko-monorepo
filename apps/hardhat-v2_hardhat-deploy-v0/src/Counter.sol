// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract Counter {
    uint256 public counter;

    uint256 public incrementAmount = 1;

    function increment() public {
        counter += incrementAmount * 1;
    }
}
