// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

/// @title AuctionBounds
/// @author Mohammed Soliman
/// @notice Single source of truth for auction parameter bounds, shared by
///         `AuctionFactory` (validation) and `DutchAuction` (constructor
///         revalidation) so the two can never drift (Constitution: no magic
///         numbers, single responsibility).
library AuctionBounds {
    /// @notice Minimum auction duration in seconds (inclusive).
    uint256 internal constant MIN_DURATION = 60;

    /// @notice Maximum auction duration in seconds (inclusive): 30 days.
    uint256 internal constant MAX_DURATION = 2_592_000;
}
