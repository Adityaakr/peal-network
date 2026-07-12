//! Scaling probe: does a batch decryption fit inside a block slot?
//!
//! Splits the recovery path into the part that can be precomputed the moment
//! the builder fixes an ordering (`pre_decrypt`, public info, no shares needed)
//! and the part that is stuck on the critical path after the operators release
//! shares (`combine` + `finalize`). For an encrypted mempool only the latter
//! competes with the slot budget.
//!
//! cargo run --release --example mempool_scaling -p bte-crypto

use bte_crypto::{
    ceremony, combine, finalize, partial, pre_decrypt, seal, verify_share, CtHeader,
    SealedCiphertext, Share,
};
use std::time::Instant;

const N: u16 = 5;
const T: u16 = 3;

fn main() {
    println!(
        "{:>5} {:>10} {:>12} {:>12} {:>12} {:>10} {:>12} {:>14}",
        "B", "seal/tx", "ceremony", "partial", "verify_1", "combine", "pre_decrypt", "FINALIZE"
    );
    println!("{}", "-".repeat(96));

    for b in [64u32, 128, 256, 512] {
        let mut rng = bte_crypto::os_rng();

        let t0 = Instant::now();
        let (params, secrets) = ceremony(N, T, b, &mut rng).unwrap();
        let t_ceremony = t0.elapsed();
        let rk = params.recovery_key();

        // A realistic mempool payload: a signed ~200-byte EVM transaction.
        let tx = vec![0xABu8; 200];

        let t0 = Instant::now();
        let batch: Vec<SealedCiphertext> =
            (0..b).map(|_| seal(&params, &tx, &mut rng).unwrap()).collect();
        let t_seal_each = t0.elapsed() / b;

        let headers: Vec<CtHeader> = batch.iter().map(|ct| ct.header()).collect();

        let t0 = Instant::now();
        let shares: Vec<Share> = secrets[..T as usize]
            .iter()
            .map(|s| partial(s, &headers).unwrap())
            .collect();
        let t_partial = t0.elapsed() / u32::from(T);

        let t0 = Instant::now();
        assert!(verify_share(&params, &headers, &shares[0]));
        let t_verify = t0.elapsed();

        // Off the critical path: runs as soon as the ordering is fixed,
        // in parallel with publishing it and waiting for shares.
        let t0 = Instant::now();
        let pre = pre_decrypt(&rk, &batch).unwrap();
        let t_pre = t0.elapsed();

        // On the critical path: everything after the shares land.
        let t0 = Instant::now();
        let cs = combine(&shares);
        let t_combine = t0.elapsed();

        let t0 = Instant::now();
        let out = finalize(&rk, &pre, &cs, &batch).unwrap();
        let t_finalize = t0.elapsed();

        assert_eq!(out.len(), b as usize);
        assert!(out.iter().all(|r| r.valid && r.payload == tx));

        println!(
            "{b:>5} {:>9.2?} {:>11.2?} {:>11.2?} {:>11.2?} {:>9.2?} {:>11.2?} {:>13.2?}",
            t_seal_each, t_ceremony, t_partial, t_verify, t_combine, t_pre, t_finalize
        );
    }

    println!();
    println!("critical path after shares arrive = combine + FINALIZE");
    println!("pre_decrypt overlaps the publish-ordering + collect-shares round trip");
}
