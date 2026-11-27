# Poolchain Devnet escrow

Bu depo şu an iki parçadan oluşuyor:

- `index.html` + `devnet.js`: Poolchain arayüzü ve Phantom/Solflare ile Devnet işlemleri. Program ID girildiğinde havuzları zincirden okur; havuz oluşturma, başvuru, seçim ve eşit dağıtımı cüzdan onayına gönderir.
- `programs/poolchain_escrow`: Solana/Anchor escrow programı kaynak kodu. SOL ve klasik SPL token havuzlarını destekler.

**Durum:** Program Anchor 0.31.1 ile derlendi ve Rust doğrulama testleri geçti. Devnet'e henüz dağıtılmadı. Dağıtımdan sonra program adresini arayüzdeki “Program ID ayarla” alanına girince Devnet zincir modu açılır; ID girilmeden demo modu görünür.

## Kurallar

- Havuz başına 1–8 katılımcı seçilebilir.
- Oluşturma sırasında toplam miktar escrow hesabına alınır. Miktar katılımcı sayısına kalansız bölünmelidir.
- Başvuran, cüzdanını imzalayıp en fazla 240 baytlık mesajını zincire yazar. Mesaj herkese açıktır; kişisel/hassas bilgi eklemeyin.
- Havuz sahibi başvuranları seçer. Bütün kontenjanlar seçildikten sonra yalnızca havuz sahibi dağıtımı başlatabilir.
- Dağıtım seçilen her başvuruyu doğrular ve her katılımcıya eşit payı aynı işlemde yollar. Solana işlemi başarısız olursa işlem atomik olarak geri alınır.
- Token desteği legacy SPL Token Program altındaki tokenlar içindir. Bilinmeyen mint adresleri resmi USDC/USDT olarak doğrulanmaz.
- Kanıt dosyaları bu programda zincire yüklenmez. Mevcut prototipin dosyaları yalnızca yükleyen kişinin tarayıcısında saklanır; diğer kullanıcılara aktarılmaz.

## Devnet'e dağıtım (Windows / WSL)

Bu proje WSL2 Ubuntu üzerinde hazırlandı. Yeni bir Windows kurulumunda WSL/Ubuntu'yu `wsl --install -d Ubuntu` ile kurun. Anchor'ın resmi Windows yolu WSL'dir: <https://www.anchor-lang.com/docs/installation>.

Ubuntu terminalinde resmi kurulum komutuyla Rust ve Solana araçlarını yükleyin; Windows için Anchor rehberi bu yöntemi öneriyor. Sonra Anchor AVM'yi kurup proje ile aynı 0.31.1 sürümünü seçin:

```bash
curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
cargo install --git https://github.com/otter-sec/anchor avm --force
avm install 0.31.1
avm use 0.31.1
```

Sonra Windows proje dizininin WSL yolu ile repo köküne gidin. Örneğin:

```bash
cd /mnt/c/Users/azraa/Documents/Codex/2026-11-26/i/outputs/dev3pach
solana config set --url devnet
solana-keygen new --silent --no-bip39-passphrase -o ~/.config/solana/id.json
solana address
mkdir -p target/deploy
solana-keygen new --no-bip39-passphrase -o target/deploy/poolchain_escrow-keypair.json
anchor keys sync
anchor build
anchor deploy --provider.cluster devnet
```

Devnet'te `solana airdrop` komutu herkese açık RPC'de kapalıdır. `solana address` çıktısını [Solana Devnet Faucet](https://faucet.solana.com/) sayfasına girerek CLI dağıtım cüzdanına test SOL iste. Daha sonra `solana balance --url devnet` ile bakiyeyi kontrol et. Program anahtarı `target/deploy/poolchain_escrow-keypair.json` içinde oluşturulur; bu dosya `.gitignore` kapsamındadır. Cüzdan dosyalarını ve kurtarma bilgilerini kimseyle paylaşma veya Git'e ekleme. Dağıtım başarılı olunca terminaldeki Program ID'yi arayüzdeki **Program ID ayarla** alanına yaz. Poolchain’de işlem yapacak Phantom/Solflare cüzdanına da ayrıca Devnet SOL gerekir.

## Kullanım sınırları

- Havuz başına 1–8 kişi seçilebilir; tutar en küçük birime kadar kişi sayısına kalansız bölünmelidir.
- Pool ve başvuru metinleri herkese açık zincir verisidir. Başvuru mesajı en fazla 240 bayttır.
- Token desteği klasik SPL Token Program'ı altındaki mintler içindir. USDC alanı Devnet USDC mint adresiyle başlar; diğer tokenlar için kendi Devnet mint adresini gir.
- Başvuru dosyaları zincire veya sunucuya yüklenmiyor; yalnızca yükleyen tarayıcıda kalıyor. Havuz sahibi bunları göremez. Paylaşılacak kanıt dosyaları için ayrı, açık rızaya dayalı dosya depolama entegrasyonu gerekir.
- SOL ve SPL havuzlarında fonlar PDA escrow hesabında tutulur. Bütün slotlar seçildikten sonra sadece havuz sahibi dağıtımı imzalayabilir.

## Yerel doğrulama

```bash
cargo test -p poolchain_escrow
anchor build
```

## Program komutları

- `create_sol_pool(pool_id, amount_lamports, slots, name, description, category)`
- `create_token_pool(pool_id, amount_base_units, slots, name, description, category)`
- `apply(message)`
- `select_applicant()`
- `approve_and_distribute()`

SPL havuzu dağıtırken kalan hesaplar her seçili alıcı için `(application PDA, wallet, associated token account)`; SOL için `(application PDA, wallet)` sırasındadır. Program hesapların havuza ait olduğunu, seçilmiş durumda olduğunu ve alıcıların tekrarlanmadığını doğrular.

