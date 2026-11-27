use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

declare_id!("11111111111111111111111111111111");

const MAX_SLOTS: u8 = 8;
const MAX_MESSAGE_BYTES: usize = 240;
const STATUS_OPEN: u8 = 0;
const STATUS_RELEASED: u8 = 1;
const APP_PENDING: u8 = 0;
const APP_SELECTED: u8 = 1;

#[program]
pub mod poolchain_escrow {
    use super::*;

    pub fn create_sol_pool(ctx: Context<CreateSolPool>, pool_id: u64, amount: u64, slots: u8, name: String, description: String, category: String) -> Result<()> {
        validate_pool(amount, slots)?;
        validate_metadata(&name, &description, &category)?;
        let pool = &mut ctx.accounts.pool;
        pool.set_inner(Pool {
            creator: ctx.accounts.creator.key(), pool_id, mint: Pubkey::default(), total_amount: amount,
            decimals: 9, is_sol: true, slots, applicants: 0, selected: 0, status: STATUS_OPEN,
            created_at: Clock::get()?.unix_timestamp, bump: ctx.bumps.pool,
            name, description, category,
        });
        system_program::transfer(CpiContext::new(ctx.accounts.system_program.to_account_info(), Transfer {
            from: ctx.accounts.creator.to_account_info(), to: pool.to_account_info(),
        }), amount)?;
        Ok(())
    }

    pub fn create_token_pool(ctx: Context<CreateTokenPool>, pool_id: u64, amount: u64, slots: u8, name: String, description: String, category: String) -> Result<()> {
        validate_pool(amount, slots)?;
        validate_metadata(&name, &description, &category)?;
        require!(amount > 0, EscrowError::InvalidAmount);
        let pool = &mut ctx.accounts.pool;
        pool.set_inner(Pool {
            creator: ctx.accounts.creator.key(), pool_id, mint: ctx.accounts.mint.key(), total_amount: amount,
            decimals: ctx.accounts.mint.decimals, is_sol: false, slots, applicants: 0, selected: 0,
            status: STATUS_OPEN, created_at: Clock::get()?.unix_timestamp, bump: ctx.bumps.pool,
            name, description, category,
        });
        token::transfer_checked(CpiContext::new(ctx.accounts.token_program.to_account_info(), TransferChecked {
            from: ctx.accounts.creator_token.to_account_info(), mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.vault.to_account_info(), authority: ctx.accounts.creator.to_account_info(),
        }), amount, ctx.accounts.mint.decimals)?;
        Ok(())
    }

    pub fn apply(ctx: Context<Apply>, message: String) -> Result<()> {
        require!(message.as_bytes().len() <= MAX_MESSAGE_BYTES, EscrowError::MessageTooLong);
        let pool = &mut ctx.accounts.pool;
        require!(pool.status == STATUS_OPEN, EscrowError::PoolClosed);
        require!(pool.selected < pool.slots, EscrowError::SlotsFull);
        require!(pool.applicants < 500, EscrowError::TooManyApplicants);
        ctx.accounts.application.set_inner(Application {
            pool: pool.key(), applicant: ctx.accounts.applicant.key(), status: APP_PENDING, message,
        });
        pool.applicants = pool.applicants.checked_add(1).ok_or(EscrowError::MathOverflow)?;
        Ok(())
    }

    pub fn select_applicant(ctx: Context<SelectApplicant>) -> Result<()> {
        require!(ctx.accounts.pool.status == STATUS_OPEN, EscrowError::PoolClosed);
        require!(ctx.accounts.application.status == APP_PENDING, EscrowError::ApplicationNotPending);
        require!(ctx.accounts.pool.selected < ctx.accounts.pool.slots, EscrowError::SlotsFull);
        ctx.accounts.application.status = APP_SELECTED;
        ctx.accounts.pool.selected = ctx.accounts.pool.selected.checked_add(1).ok_or(EscrowError::MathOverflow)?;
        Ok(())
    }

    // Remaining accounts are ordered as (application PDA, recipient wallet) for SOL,
    // or (application PDA, recipient wallet, recipient ATA) for SPL tokens.
    pub fn approve_and_distribute(ctx: Context<ApproveAndDistribute>) -> Result<()> {
        let pool_key = ctx.accounts.pool.key();
        let pool_snapshot = ctx.accounts.pool.clone();
        require!(pool_snapshot.status == STATUS_OPEN, EscrowError::PoolClosed);
        require!(pool_snapshot.selected == pool_snapshot.slots, EscrowError::SlotsNotFull);
        let width = if pool_snapshot.is_sol { 2 } else { 3 };
        require!(ctx.remaining_accounts.len() == pool_snapshot.slots as usize * width, EscrowError::InvalidRecipients);
        let share = pool_snapshot.total_amount / u64::from(pool_snapshot.slots);
        require!(share > 0, EscrowError::InvalidAmount);
        let mut recipients: Vec<Pubkey> = Vec::with_capacity(pool_snapshot.slots as usize);
        let mut seen_apps: Vec<Pubkey> = Vec::with_capacity(pool_snapshot.slots as usize);
        for group in ctx.remaining_accounts.chunks(width) {
            let app_info = &group[0];
            let app = Account::<Application>::try_from(app_info)?;
            require_keys_eq!(app.pool, pool_key, EscrowError::InvalidRecipients);
            require!(app.status == APP_SELECTED, EscrowError::InvalidRecipients);
            require_keys_eq!(app.applicant, *group[1].key, EscrowError::InvalidRecipients);
            require!(!seen_apps.contains(app_info.key), EscrowError::InvalidRecipients);
            seen_apps.push(*app_info.key);
            let recipient_info = &group[1];
            require!(recipient_info.is_writable, EscrowError::InvalidRecipients);
            require!(!recipients.contains(recipient_info.key), EscrowError::DuplicateRecipient);
            recipients.push(*recipient_info.key);
            if pool_snapshot.is_sol {
                let rent_floor = Rent::get()?.minimum_balance(Pool::SPACE);
                let balance = ctx.accounts.pool.to_account_info().lamports();
                require!(balance.saturating_sub(share) >= rent_floor, EscrowError::InsufficientEscrow);
                let source_info = ctx.accounts.pool.to_account_info();
                let source_balance = source_info.lamports();
                let destination_info = recipient_info.clone();
                let destination_balance = destination_info.lamports();
                let new_source = source_balance.checked_sub(share).ok_or(EscrowError::InsufficientEscrow)?;
                let new_destination = destination_balance.checked_add(share).ok_or(EscrowError::MathOverflow)?;
                **source_info.try_borrow_mut_lamports()? = new_source;
                **destination_info.try_borrow_mut_lamports()? = new_destination;
            } else {
                let ata = &group[2];
                let recipient_ata = Account::<TokenAccount>::try_from(ata)?;
                require_keys_eq!(recipient_ata.owner, *recipient_info.key, EscrowError::InvalidRecipients);
                require_keys_eq!(recipient_ata.mint, pool_snapshot.mint, EscrowError::InvalidRecipients);
                let bump = [pool_snapshot.bump];
                let id_bytes = pool_snapshot.pool_id.to_le_bytes();
                let creator = pool_snapshot.creator;
                let seeds: &[&[u8]] = &[b"pool", creator.as_ref(), &id_bytes, &bump];
                let mint = ctx.accounts.mint.as_ref().ok_or(EscrowError::MissingTokenAccounts)?;
                let vault = ctx.accounts.vault.as_ref().ok_or(EscrowError::MissingTokenAccounts)?;
                let token_program = ctx.accounts.token_program.as_ref().ok_or(EscrowError::MissingTokenAccounts)?;
                require_keys_eq!(mint.key(), pool_snapshot.mint, EscrowError::InvalidRecipients);
                require_keys_eq!(vault.owner, pool_key, EscrowError::InvalidRecipients);
                require_keys_eq!(vault.mint, pool_snapshot.mint, EscrowError::InvalidRecipients);
                token::transfer_checked(CpiContext::new_with_signer(token_program.to_account_info(), TransferChecked {
                    from: vault.to_account_info(), mint: mint.to_account_info(),
                    to: ata.clone(), authority: ctx.accounts.pool.to_account_info(),
                }, &[seeds]), share, pool_snapshot.decimals)?;
            }
        }
        ctx.accounts.pool.status = STATUS_RELEASED;
        Ok(())
    }
}

fn validate_metadata(name: &str, description: &str, category: &str) -> Result<()> {
    require!(!name.trim().is_empty() && name.len() <= 48, EscrowError::InvalidMetadata);
    require!(!description.trim().is_empty() && description.len() <= 180, EscrowError::InvalidMetadata);
    require!(!category.trim().is_empty() && category.len() <= 24, EscrowError::InvalidMetadata);
    Ok(())
}

fn validate_pool(amount: u64, slots: u8) -> Result<()> {
    require!(amount > 0, EscrowError::InvalidAmount);
    require!(slots > 0 && slots <= MAX_SLOTS, EscrowError::InvalidSlots);
    require!(amount % u64::from(slots) == 0, EscrowError::UnevenSplit);
    Ok(())
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct CreateSolPool<'info> {
    #[account(mut)] pub creator: Signer<'info>,
    #[account(init, payer = creator, space = Pool::SPACE, seeds = [b"pool", creator.key().as_ref(), &pool_id.to_le_bytes()], bump)]
    pub pool: Account<'info, Pool>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct CreateTokenPool<'info> {
    #[account(mut)] pub creator: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut, constraint = creator_token.owner == creator.key(), constraint = creator_token.mint == mint.key())]
    pub creator_token: Account<'info, TokenAccount>,
    #[account(init, payer = creator, space = Pool::SPACE, seeds = [b"pool", creator.key().as_ref(), &pool_id.to_le_bytes()], bump)]
    pub pool: Account<'info, Pool>,
    #[account(init, payer = creator, associated_token::mint = mint, associated_token::authority = pool)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Apply<'info> {
    #[account(mut, constraint = pool.status == STATUS_OPEN @ EscrowError::PoolClosed)] pub pool: Account<'info, Pool>,
    #[account(init, payer = applicant, space = Application::SPACE, seeds = [b"application", pool.key().as_ref(), applicant.key().as_ref()], bump)]
    pub application: Account<'info, Application>,
    #[account(mut)] pub applicant: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SelectApplicant<'info> {
    #[account(mut, has_one = creator)] pub pool: Account<'info, Pool>,
    pub creator: Signer<'info>,
    #[account(mut, constraint = application.pool == pool.key() @ EscrowError::InvalidRecipients)]
    pub application: Account<'info, Application>,
}

#[derive(Accounts)]
pub struct ApproveAndDistribute<'info> {
    #[account(mut, has_one = creator)] pub pool: Account<'info, Pool>,
    pub creator: Signer<'info>,
    pub mint: Option<Account<'info, Mint>>,
    #[account(mut)] pub vault: Option<Account<'info, TokenAccount>>,
    pub token_program: Option<Program<'info, Token>>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(Clone)]
pub struct Pool {
    pub creator: Pubkey, pub pool_id: u64, pub mint: Pubkey, pub total_amount: u64,
    pub decimals: u8, pub is_sol: bool, pub slots: u8, pub applicants: u16, pub selected: u8,
    pub status: u8, pub created_at: i64, pub bump: u8,
    pub name: String, pub description: String, pub category: String,
}
impl Pool { pub const SPACE: usize = 8 + 32 + 8 + 32 + 8 + 1 + 1 + 1 + 2 + 1 + 1 + 8 + 1 + (4 + 48) + (4 + 180) + (4 + 24); }

#[account]
#[derive(Clone)]
pub struct Application { pub pool: Pubkey, pub applicant: Pubkey, pub status: u8, pub message: String }
impl Application { pub const SPACE: usize = 8 + 32 + 32 + 1 + 4 + MAX_MESSAGE_BYTES; }

#[error_code]
pub enum EscrowError {
    #[msg("Amount must be greater than zero")] InvalidAmount,
    #[msg("Select between 1 and 8 recipients")] InvalidSlots,
    #[msg("The amount must divide evenly across recipient slots")] UnevenSplit,
    #[msg("The pool is closed")] PoolClosed,
    #[msg("The application message is too long")] MessageTooLong,
    #[msg("Too many applications")] TooManyApplicants,
    #[msg("The application is not pending")] ApplicationNotPending,
    #[msg("All recipient slots must be filled before distribution")] SlotsNotFull,
    #[msg("The selected recipients are invalid or not unique")] InvalidRecipients,
    #[msg("Recipient addresses must be unique")] DuplicateRecipient,
    #[msg("The escrow does not contain enough distributable balance")] InsufficientEscrow,
    #[msg("Arithmetic overflow")] MathOverflow,
    #[msg("Pool name, description, or category is invalid")] InvalidMetadata,
    #[msg("SPL token accounts were not provided")] MissingTokenAccounts,
}

