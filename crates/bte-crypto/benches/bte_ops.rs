//! Criterion benches at production shape: n=5, t=3, B=64.
//! Compare against the paper's single-thread numbers (121.5ms @ B=32,
//! 593.63ms @ B=128 for full decryption).

use bte_crypto::{
    ceremony, combine, finalize, partial, pre_decrypt, seal, verify_share, CtHeader,
    SealedCiphertext, Share,
};
use criterion::{criterion_group, criterion_main, Criterion};
use std::hint::black_box;

const N: u16 = 5;
const T: u16 = 3;
const B: u32 = 64;

fn bench_all(c: &mut Criterion) {
    let mut rng = bte_crypto::os_rng();
    let (params, secrets) = ceremony(N, T, B, &mut rng).unwrap();
    let rk = params.recovery_key();

    let batch: Vec<SealedCiphertext> = (0..B)
        .map(|i| {
            seal(
                &params,
                format!("bench payload {i}: a realistic sealed bid").as_bytes(),
                &mut rng,
            )
            .unwrap()
        })
        .collect();
    let headers: Vec<CtHeader> = batch.iter().map(|ct| ct.header()).collect();
    let shares: Vec<Share> = secrets[..T as usize]
        .iter()
        .map(|s| partial(s, &headers).unwrap())
        .collect();

    c.bench_function("seal (1 payload)", |b| {
        b.iter(|| {
            seal(
                &params,
                black_box(b"a realistic sealed bid payload"),
                &mut rng,
            )
            .unwrap()
        })
    });

    c.bench_function("partial (one 48-byte share for B=64)", |b| {
        b.iter(|| partial(&secrets[0], black_box(&headers)).unwrap())
    });

    c.bench_function("verify_share (B=64)", |b| {
        b.iter(|| assert!(verify_share(&params, black_box(&headers), &shares[0])))
    });

    let mut group = c.benchmark_group("recover");
    group.sample_size(10);
    group.bench_function("pre_decrypt (pipelined, B=64)", |b| {
        b.iter(|| pre_decrypt(&rk, black_box(&batch)).unwrap())
    });
    group.bench_function("finalize (B=64)", |b| {
        let pre = pre_decrypt(&rk, &batch).unwrap();
        let combined = combine(&shares);
        b.iter(|| finalize(&rk, &pre, &combined, black_box(&batch)).unwrap())
    });
    group.bench_function(
        "recover end-to-end (verify t shares + pre_decrypt + finalize, B=64)",
        |b| b.iter(|| bte_crypto::recover(&params, black_box(&batch), &shares).unwrap()),
    );
    group.finish();
}

criterion_group!(benches, bench_all);
criterion_main!(benches);
