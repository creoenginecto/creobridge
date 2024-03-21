use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount, Transfer};

declare_id!("Fc8Kj9zkE7fLuLnpxZyArs3oJj3EKuaLj9XNGQ2GQbwY");

// used as a generic address for any non-Solana chain
// the address is supposed to be stored as a sequence
// of bytes, not as a string
// the address does not have to be a valid ed25519
// pubkey, which is why we don't use the Pubkey type
// also used to identify different chains encoded as a null-terminated string, e.g. 'evm.97'
#[derive(Default, AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub struct Bytes32 {
    byte: [u8; 32],
}

// a program for bridging tokens between Solana and other chains
// the bridge owner is trusted with relaying information from other chains
// the program supports fees & send limits

#[program]
pub mod bridge_solana {
    use super::*;

    const MAX_FEE: u16 = 10000;

    // initialize a bridge instance
    // bridge can be paused
    // _version allows having multiple bridge instances for one token, owner and chain
    // current chain is a null-terminated 'sol.mainnet-beta' string for Solana mainnet,
    // but can be different for Solana forks or devnets
    pub fn initialize(
        ctx: Context<Initialize>,
        fee_send: u16,
        fee_fulfill: u16,
        limit_send: u64,
        paused: bool,
        _version: u64,
        _current_chain: Bytes32,
    ) -> Result<()> {
        require_gt!(MAX_FEE, fee_send, BridgeError::SendFeeTooHigh);
        require_gt!(MAX_FEE, fee_fulfill, BridgeError::FulfillFeeTooHigh);

        ctx.accounts.bridge_params.fee_send = fee_send;
        ctx.accounts.bridge_params.fee_fulfill = fee_fulfill;
        ctx.accounts.bridge_params.limit_send = limit_send;
        ctx.accounts.bridge_params.fee_recipient = ctx.accounts.fee_account.key();
        ctx.accounts.bridge_params.paused = paused;
        Ok(())
    }

    // change params of a bridge instance
    // limit_send is the maximum amount of token allowed to be bridged in a single tx
    pub fn set_params(
        ctx: Context<SetParams>,
        _token_mint: Pubkey,
        fee_send: u16,
        fee_fulfill: u16,
        limit_send: u64,
        paused: bool,
        _version: u64,
        _current_chain: Bytes32,
    ) -> Result<()> {
        require_gt!(MAX_FEE, fee_send, BridgeError::SendFeeTooHigh);
        require_gt!(MAX_FEE, fee_fulfill, BridgeError::FulfillFeeTooHigh);

        ctx.accounts.bridge_params.fee_send = fee_send;
        ctx.accounts.bridge_params.fee_fulfill = fee_fulfill;
        ctx.accounts.bridge_params.limit_send = limit_send;
        ctx.accounts.bridge_params.fee_recipient = ctx.accounts.fee_account.key();
        ctx.accounts.bridge_params.paused = paused;
        Ok(())
    }

    // allow/ban specific chains and set the exchange rate for the chain
    // exchange rate is a multiplier that fixes the difference between decimals on different
    // chains
    pub fn set_chain_data(
        ctx: Context<SetChainData>,
        _token_mint: Pubkey,
        enabled: bool,
        exchange_rate_from: u64,
        _version: u64,
        _current_chain: Bytes32,
        _chain: Bytes32,
    ) -> Result<()> {
        require_gt!(exchange_rate_from, 0, BridgeError::ExchangeRateZero);
        ctx.accounts.chain_data.enabled = enabled;
        ctx.accounts.chain_data.exchange_rate_from = exchange_rate_from;
        Ok(())
    }

    // fulfill a bridge tx from another chain
    pub fn fulfill(
        ctx: Context<Fulfill>,
        _nonce: u64,
        amount: u64,
        version: u64,
        current_chain: Bytes32,
        _from_chain: Bytes32,
    ) -> Result<()> {
        require!(
            !ctx.accounts.bridge_params.paused,
            BridgeError::BridgePaused
        );
        require!(
            ctx.accounts.from_chain_data.enabled,
            BridgeError::ChainDisabled
        );

        // the conversion is needed to account for decimal differences between chains
        let amount_converted = amount * ctx.accounts.from_chain_data.exchange_rate_from;
        let fee_fulfill = ctx.accounts.bridge_params.fee_fulfill;
        // can not overflow as fee_fulfill is < MAX_FEE
        let fee =
            (u128::from(amount_converted) * u128::from(fee_fulfill) / u128::from(MAX_FEE)) as u64;
        let amount_taxed = amount_converted - fee;

        // transfer

        require_gt!(amount_taxed, 0, BridgeError::AmountTooLow);

        let version = version.to_be_bytes();
        let owner_key = ctx.accounts.owner.key();
        let token_mint_key = ctx.accounts.token_mint.key();
        let bump: u8 = *ctx.bumps.get("bridge_token_account").unwrap();

        let seeds = &[
            version.as_ref(),
            b"wallet".as_ref(),
            owner_key.as_ref(),
            token_mint_key.as_ref(),
            current_chain.byte.as_ref(),
            &[bump],
        ];
        let signer = &[&seeds[..]];

        let transfer_instruction = Transfer {
            from: ctx.accounts.bridge_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.bridge_token_account.to_account_info(),
        };

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_instruction,
            signer,
        );

        anchor_spl::token::transfer(cpi_ctx, amount_taxed)?;

        if fee > 0 {
            let transfer_instruction = Transfer {
                from: ctx.accounts.bridge_token_account.to_account_info(),
                to: ctx.accounts.fee_account.to_account_info(),
                authority: ctx.accounts.bridge_token_account.to_account_info(),
            };

            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                transfer_instruction,
                signer,
            );

            anchor_spl::token::transfer(cpi_ctx, fee)?;
        }
        Ok(())
    }

    // withdraw tokens from the bridge. can only be called by the owner
    pub fn withdraw(ctx: Context<Withdraw>, version: u64, current_chain: Bytes32) -> Result<()> {
        // transfer
        let amount = ctx.accounts.bridge_token_account.amount;

        require_gt!(amount, 0, BridgeError::WithdrawZero);

        let version = version.to_be_bytes();
        let owner_key = ctx.accounts.owner.key();
        let token_mint_key = ctx.accounts.token_mint.key();
        let bump: u8 = *ctx.bumps.get("bridge_token_account").unwrap();

        let seeds = &[
            version.as_ref(),
            b"wallet".as_ref(),
            owner_key.as_ref(),
            token_mint_key.as_ref(),
            current_chain.byte.as_ref(),
            &[bump],
        ];
        let signer = &[&seeds[..]];

        let transfer_instruction = Transfer {
            from: ctx.accounts.bridge_token_account.to_account_info(),
            to: ctx.accounts.withdraw_token_account.to_account_info(),
            authority: ctx.accounts.bridge_token_account.to_account_info(),
        };

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_instruction,
            signer,
        );

        anchor_spl::token::transfer(cpi_ctx, amount)?;
        Ok(())
    }

    // send a bridge tx to another chain
    pub fn send(
        ctx: Context<Send>,
        _owner: Pubkey,
        _token_mint: Pubkey,
        amount: u64,
        to: Bytes32,
        _version: u64,
        to_chain: Bytes32,
        _current_chain: Bytes32,
    ) -> Result<()> {
        require!(
            !ctx.accounts.bridge_params.paused,
            BridgeError::BridgePaused
        );
        require!(
            ctx.accounts.to_chain_data.enabled,
            BridgeError::ChainDisabled
        );
        require_gte!(
            ctx.accounts.bridge_params.limit_send,
            amount,
            BridgeError::SendLimitExceeded
        );

        // prevent a small amount of token from being lost
        require_eq!(
            amount % ctx.accounts.to_chain_data.exchange_rate_from,
            0,
            BridgeError::AmountUneven
        );

        // make sure at least some fee will be taken from each bridge tx
        require_gte!(
            amount / ctx.accounts.to_chain_data.exchange_rate_from,
            u64::from(MAX_FEE),
            BridgeError::AmountTooLow
        );

        // the conversion is needed to account for decimal differences between chains
        let amount_converted = amount / ctx.accounts.to_chain_data.exchange_rate_from;
        let fee_send = ctx.accounts.bridge_params.fee_send;
        // can not overflow as fee_send is < MAX_FEE
        let fee =
            (u128::from(amount_converted) * u128::from(fee_send) / u128::from(MAX_FEE)) as u64;
        let amount_taxed = amount_converted - fee;

        // transfer token to the bridge

        let transfer_instruction = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.bridge_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(), // "from" authority
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            transfer_instruction,
        );

        anchor_spl::token::transfer(
            cpi_ctx,
            amount_taxed * ctx.accounts.to_chain_data.exchange_rate_from,
        )?;

        // transfer fee to the fee account
        if fee > 0 {
            let transfer_instruction = Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.fee_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(), // "from" authority
            };
            let cpi_ctx = CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                transfer_instruction,
            );

            anchor_spl::token::transfer(
                cpi_ctx,
                fee * ctx.accounts.to_chain_data.exchange_rate_from,
            )?;
        }

        // write send tx to the account

        ctx.accounts.send_tx.initiator = ctx.accounts.user.key();
        ctx.accounts.send_tx.amount = amount_taxed;
        ctx.accounts.send_tx.to = to;
        ctx.accounts.send_tx.nonce = ctx.accounts.send_nonce.nonce;
        // the timestemp is only used on the frontend
        ctx.accounts.send_tx.timestamp = Clock::get()?.unix_timestamp;
        ctx.accounts.send_tx.to_chain = to_chain;
        ctx.accounts.send_tx.block = Clock::get()?.slot;

        // increment the nonce

        ctx.accounts.send_nonce.nonce += 1;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(fee_send: u16, fee_fulfill: u16, limit_send: u64, paused: bool, _version: u64, _current_chain: Bytes32)]
pub struct Initialize<'info> {
    // id of the token used by the bridge instance
    pub token_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = owner,
        seeds = [
            _version.to_be_bytes().as_ref(),
            b"wallet".as_ref(),
            owner.key().as_ref(),
            token_mint.key().as_ref(),
            _current_chain.byte.as_ref(),
        ],
        bump,
        token::mint=token_mint,
        token::authority=bridge_token_account,
    )]
    // token account that holds the bridge's tokens
    // has to be topped up before the bridge can be used
    pub bridge_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    // owner of the bridge who can change params and withdraw tokens
    pub owner: Signer<'info>,
    #[account(
        mut,
        constraint = fee_account.mint == token_mint.key(),
    )]
    // account that receives the fees
    pub fee_account: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = owner,
        seeds = [
            _version.to_be_bytes().as_ref(),
            b"bridge_params".as_ref(),
            owner.key().as_ref(),
            token_mint.key().as_ref(),
            _current_chain.byte.as_ref(),
        ],
        space = 8 + BridgeParams::MAX_SIZE,
        bump,
    )]
    // account that stores params for this bridge instance
    pub bridge_params: Account<'info, BridgeParams>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(_token_mint: Pubkey, fee_send: u16, fee_fulfill: u16, limit_send: u64, paused: bool, _version: u64, _current_chain: Bytes32)]
pub struct SetParams<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [
            _version.to_be_bytes().as_ref(),
            b"bridge_params".as_ref(),
            owner.key().as_ref(),
            _token_mint.as_ref(),
            _current_chain.byte.as_ref(),
        ],
        bump,
    )]
    // address of the bridge params account to change
    pub bridge_params: Account<'info, BridgeParams>,
    #[account(
        mut,
        constraint = fee_account.mint == _token_mint.key(),
    )]
    // the new fee account
    pub fee_account: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
#[instruction(_token_mint: Pubkey, enabled: bool, exchange_rate_from: u64, _version: u64, _current_chain: Bytes32, _chain: Bytes32)]
pub struct SetChainData<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init_if_needed,
        payer = owner,
        seeds = [
            _version.to_be_bytes().as_ref(),
            b"chain_data".as_ref(),
            owner.key().as_ref(),
            _token_mint.as_ref(),
            _current_chain.byte.as_ref(),
            _chain.byte.as_ref(),
        ],
        space = 8 + ChainData::MAX_SIZE,
        bump,
    )]
    // the chain data account to change
    pub chain_data: Account<'info, ChainData>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(_owner: Pubkey, _token_mint: Pubkey, amount: u64, to: Bytes32, _version: u64, to_chain: Bytes32, _current_chain: Bytes32)]
pub struct Send<'info> {
    #[account(
        init_if_needed,
        payer = user,
        seeds = [
            _version.to_be_bytes().as_ref(),
            b"send_nonce".as_ref(),
            _owner.as_ref(),
            _token_mint.as_ref(),
            user.key().as_ref(),
            _current_chain.byte.as_ref(),
        ],
        space = 8 + UserNonce::MAX_SIZE,
        bump
    )]
    // stores the nonce for the user
    // nonce is a number unique to each bridge tx by a user from a bridge instance
    pub send_nonce: Account<'info, UserNonce>,
    #[account(
        init,
        payer = user,
        seeds = [
            _version.to_be_bytes().as_ref(),
            b"send_tx".as_ref(),
            _owner.as_ref(),
            _token_mint.as_ref(),
            user.key().as_ref(),
            send_nonce.nonce.to_be_bytes().as_ref(),
            _current_chain.byte.as_ref(),
        ],
        space = 8 + BridgeSendTx::MAX_SIZE,
        bump
    )]
    // stores the send tx data (amount, to, etc.)
    pub send_tx: Account<'info, BridgeSendTx>,
    #[account(
        mut,
        token::mint = _token_mint,
        token::authority = user,
    )]
    // token account to take tokens from
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [
            _version.to_be_bytes().as_ref(),
            b"wallet".as_ref(),
            _owner.as_ref(),
            _token_mint.as_ref(),
            _current_chain.byte.as_ref(),
        ],
        bump,
    )]
    // token account to store tokens in
    pub bridge_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = fee_account.key() == bridge_params.fee_recipient.key(),
        constraint = fee_account.mint == _token_mint.key(),
    )]
    // account that receives the fees
    pub fee_account: Account<'info, TokenAccount>,
    #[account(
        seeds = [
            _version.to_be_bytes().as_ref(),
            b"bridge_params".as_ref(),
            _owner.as_ref(),
            _token_mint.as_ref(),
            _current_chain.byte.as_ref(),
        ],
        bump,
    )]
    // account that stores params for this bridge instance
    pub bridge_params: Account<'info, BridgeParams>,
    #[account(
        seeds = [
            _version.to_be_bytes().as_ref(),
            b"chain_data".as_ref(),
            _owner.as_ref(),
            _token_mint.as_ref(),
            _current_chain.byte.as_ref(),
            to_chain.byte.as_ref(),
        ],
        bump,
    )]
    // account that stores params for the destination chain
    pub to_chain_data: Account<'info, ChainData>,
    #[account(mut)]
    // the bridge user's account
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(_version: u64, _current_chain: Bytes32)]
pub struct Withdraw<'info> {
    pub token_mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = token_mint,
    )]
    // token account to send tokens to
    pub withdraw_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [
            _version.to_be_bytes().as_ref(),
            b"wallet".as_ref(),
            owner.key().as_ref(),
            token_mint.key().as_ref(),
            _current_chain.byte.as_ref(),
        ],
        bump,
    )]
    // token account to send tokens from
    pub bridge_token_account: Account<'info, TokenAccount>,

    // the bridge owner's account
    pub owner: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(_nonce: u64, amount: u64, _version: u64, _current_chain: Bytes32, _from_chain: Bytes32)]
pub struct Fulfill<'info> {
    pub token_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = user,
        seeds = [
            _version.to_be_bytes().as_ref(),
            b"fulfilled".as_ref(),
            owner.key().as_ref(),
            token_mint.key().as_ref(),
            _nonce.to_be_bytes().as_ref(),
            _from_chain.byte.as_ref(),
            _current_chain.byte.as_ref(),
        ],
        space = 8,
        bump
    )]
    // check double spend
    // The account can be empty because the mere existence of
    // an account with the same seeds will revert the transaction
    // on "empty_account" initialization.
    pub empty_account: Account<'info, EmptyAccount>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_mint,
        associated_token::authority = user
    )]
    // token account to send tokens to
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [
            _version.to_be_bytes().as_ref(),
            b"wallet".as_ref(),
            owner.key().as_ref(),
            token_mint.key().as_ref(),
            _current_chain.byte.as_ref(),
        ],
        bump,
    )]
    // token account to send tokens from
    pub bridge_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = fee_account.key() == bridge_params.fee_recipient.key(),
        constraint = fee_account.mint == token_mint.key(),
    )]
    // account that receives the fees
    pub fee_account: Box<Account<'info, TokenAccount>>,
    #[account(
        seeds = [
            _version.to_be_bytes().as_ref(),
            b"bridge_params".as_ref(),
            owner.key().as_ref(),
            token_mint.key().as_ref(),
            _current_chain.byte.as_ref(),
        ],
        bump,
    )]
    // account that stores params for this bridge instance
    pub bridge_params: Box<Account<'info, BridgeParams>>,
    #[account(
        seeds = [
            _version.to_be_bytes().as_ref(),
            b"chain_data".as_ref(),
            owner.key().as_ref(),
            token_mint.key().as_ref(),
            _current_chain.byte.as_ref(),
            _from_chain.byte.as_ref(),
        ],
        bump,
    )]
    // account that stores params for the source chain
    pub from_chain_data: Box<Account<'info, ChainData>>,
    #[account(mut)]
    // the bridge user's account
    pub user: Signer<'info>,
    // the bridge owner's account
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[account]
#[derive(Default)]
// account that stores the amount of tx sent by
// a user from a bridge instance
pub struct UserNonce {
    pub nonce: u64,
}

impl UserNonce {
    pub const MAX_SIZE: usize = 8;
}

#[account]
#[derive(Default)]
// stores data for a sent tx
pub struct BridgeSendTx {
    pub initiator: Pubkey,
    pub amount: u64,
    // recipient address on the destination chain
    pub to: Bytes32,
    pub nonce: u64,
    pub timestamp: i64,
    pub to_chain: Bytes32,
    pub block: u64,
}

impl BridgeSendTx {
    pub const MAX_SIZE: usize = 32 + 8 + 32 + 8 + 8 + 32 + 8;
}

#[account]
#[derive(Default)]
pub struct BridgeParams {
    pub fee_send: u16,
    pub fee_fulfill: u16,
    // max send limit per tx
    pub limit_send: u64,
    pub fee_recipient: Pubkey,
    pub paused: bool,
}

impl BridgeParams {
    pub const MAX_SIZE: usize = 2 + 2 + 8 + 32 + 1;
}

#[account]
#[derive(Default)]
pub struct ChainData {
    pub enabled: bool,
    pub exchange_rate_from: u64,
}

impl ChainData {
    pub const MAX_SIZE: usize = 1 + 32;
}

#[account]
#[derive(Default)]
pub struct EmptyAccount {}

#[error_code]
pub enum BridgeError {
    SendFeeTooHigh,
    FulfillFeeTooHigh,
    ExchangeRateZero,
    BridgePaused,
    ChainDisabled,
    AmountTooLow,
    WithdrawZero,
    SendLimitExceeded,
    AmountUneven,
}
