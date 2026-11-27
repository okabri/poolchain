import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { readFileSync } from "node:fs";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

const idl = JSON.parse(readFileSync("target/idl/poolchain_escrow.json", "utf8")) as anchor.Idl;
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = new anchor.Program(idl, provider) as any;

describe("Poolchain Devnet escrow smoke test", function () {
  this.timeout(180_000);

  it("creates a SOL escrow, records an application, selects it, and pays the exact share", async () => {
    const creator = provider.wallet.publicKey;
    const applicant = Keypair.generate();
    const poolId = new anchor.BN(Date.now()).muln(1000).addn(Math.floor(Math.random() * 1000));
    const amount = new anchor.BN("10000000"); // 0.01 SOL, one recipient
    const [pool] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), creator.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const [application] = PublicKey.findProgramAddressSync(
      [Buffer.from("application"), pool.toBuffer(), applicant.publicKey.toBuffer()],
      program.programId,
    );

    const fundApplicant = new Transaction().add(SystemProgram.transfer({
      fromPubkey: creator,
      toPubkey: applicant.publicKey,
      lamports: 20_000_000,
    }));
    await provider.sendAndConfirm(fundApplicant);

    await program.methods.createSolPool(
      poolId, amount, 1, "Poolchain Devnet smoke test", "Automated escrow round trip", "Test",
    ).accounts({ creator, pool, systemProgram: SystemProgram.programId }).rpc();

    await program.methods.apply("Devnet smoke-test application")
      .accounts({ pool, application, applicant: applicant.publicKey, systemProgram: SystemProgram.programId })
      .signers([applicant]).rpc();

    await program.methods.selectApplicant()
      .accounts({ pool, creator, application }).rpc();

    const before = await provider.connection.getBalance(applicant.publicKey, "confirmed");
    const distributionSig = await program.methods.approveAndDistribute()
      .accounts({
        pool, creator, mint: null, vault: null, tokenProgram: null,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: application, isSigner: false, isWritable: false },
        { pubkey: applicant.publicKey, isSigner: false, isWritable: true },
      ])
      .rpc();
    let transaction = null;
    for (let attempt = 0; attempt < 10 && !transaction; attempt++) {
      transaction = await provider.connection.getTransaction(distributionSig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (!transaction) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const poolAccount = await program.account.pool.fetch(pool);
    const recipientIndex = transaction?.transaction.message.accountKeys.findIndex(
      (key) => key.equals(applicant.publicKey),
    ) ?? -1;
    const received = recipientIndex >= 0 && transaction?.meta
      ? transaction.meta.postBalances[recipientIndex] - transaction.meta.preBalances[recipientIndex]
      : 0;
    console.log({ pool: pool.toBase58(), applicant: applicant.publicKey.toBase58(), before, received, distributionSig, status: poolAccount.status, selected: poolAccount.selected });

    expect(transaction).to.not.equal(null);
    expect(received).to.equal(10_000_000);
    expect(poolAccount.status).to.equal(1);
    expect(poolAccount.selected).to.equal(1);
  });
});

