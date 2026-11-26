# Define all magic words with corresponding dates (for reference)
magic_words = [
    #("expo", "20250422"),
    #("soil", "20250512"),
    #("june", "20250602"),
    #("heat", "20250623"),
    #("wave", "20250715"),
    #("rain", "20250806"),
    #("rise", "20250825"),
    #("once", "20250915"),
    #("upon", "20250915"),
    #("time", "20251027"),
    #("tech", "20251118"),
    #("xmas", "20251208"),
    #("pbrc", "20251231"),
    #("code", "20260119"),
    # ("bond", "20260209"),
    # ("date", "20260302"),
    # ("hope", "20260323"),
    #("rain", "20260409"),
    #("drop", "20260504"),
    #("june", "20260526"),
    #("bear", "20260615"),
    #("july", "20260706"),
    ("curl", "20260727"),
    ("Soul", "20260817"),
    ("dust", "20260907"),
    ("four", "20260928"),
    ("wild", "20261015"),
    ("cats", "20261111"),
    
]

# Loop through each magic word
for magic_word, date in magic_words:
    # Rearrange letters and capitalize the first letter
    output_word = magic_word[0].upper() + magic_word[3] + magic_word[1] + magic_word[2]
    
    # Print formatted results
    print(f"Input: {magic_word} ({date})")
    print(f"cdcdev04(pbrcadm) output:\t04{output_word}$$")
    print(f"log (pbrcbar) output:\t\t72{output_word}$$")
    print(f"               fcs 76a still using curl")
    print(f"               fcs 6e and 8e for backup still using curl")
    print("-" * 50)
